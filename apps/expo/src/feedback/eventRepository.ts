/**
 * Event repository — TS port of solidarity/Services/Utils/EventRepository.swift.
 *
 * Append-only circular event log for audit / sync diagnostics. The Swift
 * repository persists to an encrypted file (`event_participations.encrypted`)
 * sized by domain content; the RN port uses MMKV (already encrypted at rest
 * via the master-key passphrase, see `storage/mmkv.ts`) with a single
 * envelope key.
 *
 * Buffer cap (`MAX_EVENTS`) is 500, matching Swift's bounded log so we
 * never balloon the on-device storage on a long-running install.
 *
 * No UI consumer yet — this file is the producer for `zkLogger.warn/error`
 * and future telemetry sinks. Drop-in compatible with the Swift wire shape
 * (id, kind, payload, at) for cross-platform export/import.
 */
import { uuid } from '@solidarity/shared';

import { getMmkv } from '@/storage/mmkv';

const MAX_EVENTS = 500;
const STORAGE_KEY = 'events:log';

export interface EventRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly at: Date;
}

interface StoredRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly at: string;
}

function readStored(): StoredRecord[] {
  try {
    const raw = getMmkv().getString(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredRecord[]) : [];
  } catch {
    return [];
  }
}

function writeStored(records: readonly StoredRecord[]): void {
  try {
    getMmkv().set(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage failure isn't critical for a diagnostic log — swallow so the
    // caller (often a logger) never crashes on a write error.
  }
}

function toRecord(stored: StoredRecord): EventRecord {
  return {
    id: stored.id,
    kind: stored.kind,
    payload: stored.payload,
    at: new Date(stored.at),
  };
}

export function record(kind: string, payload: unknown): void {
  const entry: StoredRecord = {
    id: uuid(),
    kind,
    payload,
    at: new Date().toISOString(),
  };
  const current = readStored();
  const next = [...current, entry];
  const trimmed = next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
  writeStored(trimmed);
}

export function recent(limit?: number): readonly EventRecord[] {
  const stored = readStored();
  const sliced = limit !== undefined ? stored.slice(-Math.max(0, limit)) : stored;
  return sliced.map(toRecord);
}

export function clear(): void {
  try {
    getMmkv().remove(STORAGE_KEY);
  } catch {
    // Same rationale as writeStored — never bubble up from a clear call.
  }
}
