/**
 * Offline manager — TS port of solidarity/Services/Utils/OfflineManager.swift
 * + OfflineManager+Types.swift.
 *
 * Generic pending-operation queue: when network is unavailable callers
 * enqueue a typed op; on reconnect a handler drains the queue. Each op
 * carries an attempt counter and is dropped after `MAX_ATTEMPTS`, matching
 * Swift's `PendingOperation.maxRetries = 3` default.
 *
 * Backed by MMKV under the `offline:` key prefix so the queue survives
 * relaunches. We intentionally avoid wiring callers (sakura, OIDC, backup)
 * in this wave — the Swift integration sites are in Wave 4d.
 */
import { uuid } from '@solidarity/shared';

import { getMmkv } from '@/storage/mmkv';

export type PendingOpKind = 'sakura-send' | 'oidc-submit' | 'backup-upload';

export interface PendingOp {
  readonly id: string;
  readonly kind: PendingOpKind;
  readonly payload: unknown;
  readonly enqueuedAt: Date;
  readonly attempts: number;
}

interface StoredPendingOp {
  readonly id: string;
  readonly kind: PendingOpKind;
  readonly payload: unknown;
  readonly enqueuedAt: string;
  readonly attempts: number;
}

/** Match Swift's PendingOperation.maxRetries default. */
const MAX_ATTEMPTS = 3;
const KEY_PREFIX = 'offline:';

function storageKey(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

function readStored(id: string): StoredPendingOp | null {
  try {
    const raw = getMmkv().getString(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPendingOp;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(op: StoredPendingOp): void {
  getMmkv().set(storageKey(op.id), JSON.stringify(op));
}

function removeStored(id: string): void {
  try {
    getMmkv().remove(storageKey(id));
  } catch {
    // No-op — caller is the queue itself.
  }
}

function listStoredIds(): readonly string[] {
  return getMmkv()
    .getAllKeys()
    .filter((k) => k.startsWith(KEY_PREFIX))
    .map((k) => k.slice(KEY_PREFIX.length));
}

function toPublic(stored: StoredPendingOp): PendingOp {
  return {
    id: stored.id,
    kind: stored.kind,
    payload: stored.payload,
    enqueuedAt: new Date(stored.enqueuedAt),
    attempts: stored.attempts,
  };
}

export function enqueue(op: Omit<PendingOp, 'id' | 'enqueuedAt' | 'attempts'>): void {
  const stored: StoredPendingOp = {
    id: uuid(),
    kind: op.kind,
    payload: op.payload,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  };
  writeStored(stored);
}

export function listPending(): readonly PendingOp[] {
  const out: PendingOp[] = [];
  for (const id of listStoredIds()) {
    const stored = readStored(id);
    if (stored) out.push(toPublic(stored));
  }
  // Stable order by enqueuedAt so flushers process FIFO.
  out.sort((a, b) => a.enqueuedAt.getTime() - b.enqueuedAt.getTime());
  return out;
}

export function clearPending(): void {
  for (const id of listStoredIds()) {
    removeStored(id);
  }
}

/**
 * Drain the queue. The handler returns `true` on success (op removed);
 * `false` increments the attempt counter, and ops that exceed
 * `MAX_ATTEMPTS` are dropped. Mirrors Swift's executePendingOperations
 * loop: handler exceptions are treated as a `false` result so a single
 * misbehaving handler doesn't poison the rest of the queue.
 */
export async function flush(handler: (op: PendingOp) => Promise<boolean>): Promise<void> {
  for (const op of listPending()) {
    let success: boolean;
    try {
      success = await handler(op);
    } catch {
      success = false;
    }
    if (success) {
      removeStored(op.id);
      continue;
    }
    const nextAttempts = op.attempts + 1;
    if (nextAttempts >= MAX_ATTEMPTS) {
      removeStored(op.id);
      continue;
    }
    writeStored({
      id: op.id,
      kind: op.kind,
      payload: op.payload,
      enqueuedAt: op.enqueuedAt.toISOString(),
      attempts: nextAttempts,
    });
  }
}
