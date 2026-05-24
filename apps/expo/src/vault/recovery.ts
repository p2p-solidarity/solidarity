/**
 * Recovery — collect shards from the inbox + reconstruct the root secret.
 *
 * Mirrors solidarity/Services/Vault/ShardDistributionService+Recovery.swift.
 *
 * The recovery flow is split into three observable steps so the UI can
 * surface progress (Rule 8 — loading / ready / error):
 *
 *   1. `addReceivedShard(envelope, wrapKey)` is called by the inbox poller
 *      whenever a `vault.shard.v1` message arrives. It unwraps the envelope
 *      (auth tag checks the vault/guardian/index binding) and appends the
 *      raw Shamir share to the pending recovery for that vault id.
 *   2. `reconstructRootSecret(vaultId)` runs Shamir `combine` once at least
 *      `threshold` shards are collected. Returns `null` (with collected/needed
 *      info) when more are required.
 *   3. `clearRecoveryState(vaultId)` drops the local pending shards after a
 *      successful recovery (or user cancel).
 *
 * Persisted state lives in MMKV under `vault.recovery:<vaultId>` so the
 * recovery survives app restarts (Rule 9).
 */
import {
  combine,
  type ShamirShare,
} from '@solidarity/shared';

import { getMmkv } from '@/storage/mmkv';
import { decryptJson, encryptJson } from '@/storage/encryptionManager';

import { parseShardPayloadBytes } from './shardDistribution';
import {
  unwrapShard,
  type WrappedShardEnvelope,
} from './shardEnvelope';

const RECOVERY_PREFIX = 'vault.recovery:';

/** One unwrapped share waiting to be combined. */
interface PendingShard {
  readonly shardIndex: number;
  /** y-bytes for Shamir (everything after the 1-byte index prefix). */
  readonly yBase64: string;
  readonly receivedAt: string;
}

interface PendingRecovery {
  readonly vaultId: string;
  readonly threshold: number;
  readonly shards: readonly PendingShard[];
}

export interface AddShardResult {
  readonly kind: 'ok' | 'duplicate' | 'authFailed' | 'bindingMismatch' | 'decodeFailed';
  readonly vaultId: string;
  readonly collected: number;
  readonly threshold: number;
  readonly ready: boolean;
}

export interface ReconstructResult {
  readonly kind: 'ok' | 'pending' | 'err';
  readonly rootSecret?: Uint8Array;
  readonly collected: number;
  readonly threshold: number;
  readonly reason?: 'noShards' | 'combineFailed';
}

function recoveryKey(vaultId: string): string {
  // Mirror the case-normalisation we apply when wrapping envelopes so
  // callers can pass either casing and still hit the same row.
  return `${RECOVERY_PREFIX}${vaultId.toUpperCase()}`;
}

async function loadRecovery(vaultId: string): Promise<PendingRecovery | null> {
  const raw = getMmkv().getString(recoveryKey(vaultId));
  return raw ? await decryptJson<PendingRecovery>(raw) : null;
}

async function saveRecovery(rec: PendingRecovery): Promise<void> {
  getMmkv().set(recoveryKey(rec.vaultId), await encryptJson(rec));
}

function base64ToBytes(b64: string): Uint8Array {
  // Minimal local base64 decode so we don't pull a second copy of the
  // base64 helpers; reuses the standard alphabet.
  return Uint8Array.from(
    atob(b64),
    (c) => c.charCodeAt(0)
  );
}

function bytesToBase64(b: Uint8Array): string {
  let s = '';
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s);
}

/**
 * Process an inbound shard envelope. The wrap key is the local vault root
 * secret of THIS device for an own-vault recovery, OR — for a recovery on
 * a *different* device — the contact-shared wrap key the recovering device
 * holds. Right now we surface the same single-root-key model as Swift
 * (`InactivityMonitorService.getItemEncryptionKey`).
 */
export async function addReceivedShard(
  envelope: WrappedShardEnvelope,
  wrapKey: Uint8Array
): Promise<AddShardResult> {
  const baseResult = {
    vaultId: envelope.vaultId,
    threshold: envelope.threshold,
  };

  const unwrap = unwrapShard(envelope, wrapKey, envelope.threshold);
  if (unwrap.kind === 'err') {
    const pending = await loadRecovery(envelope.vaultId);
    const collected = pending?.shards.length ?? 0;
    const kind =
      unwrap.reason === 'authFailed'
        ? 'authFailed'
        : unwrap.reason === 'bindingMismatch'
          ? 'bindingMismatch'
          : 'decodeFailed';
    return {
      ...baseResult,
      kind,
      collected,
      ready: collected >= envelope.threshold,
    };
  }

  const parsed = parseShardPayloadBytes(unwrap.shardBytes);
  if (!parsed) {
    const pending = await loadRecovery(envelope.vaultId);
    const collected = pending?.shards.length ?? 0;
    return {
      ...baseResult,
      kind: 'decodeFailed',
      collected,
      ready: collected >= envelope.threshold,
    };
  }

  const existing = (await loadRecovery(envelope.vaultId)) ?? {
    vaultId: envelope.vaultId,
    threshold: envelope.threshold,
    shards: [] as PendingShard[],
  };

  if (existing.shards.some((s) => s.shardIndex === parsed.index)) {
    return {
      ...baseResult,
      kind: 'duplicate',
      collected: existing.shards.length,
      ready: existing.shards.length >= envelope.threshold,
    };
  }

  const next: PendingRecovery = {
    vaultId: envelope.vaultId,
    threshold: envelope.threshold,
    shards: [
      ...existing.shards,
      {
        shardIndex: parsed.index,
        yBase64: bytesToBase64(parsed.y),
        receivedAt: new Date().toISOString(),
      },
    ],
  };
  await saveRecovery(next);

  return {
    ...baseResult,
    kind: 'ok',
    collected: next.shards.length,
    ready: next.shards.length >= envelope.threshold,
  };
}

/**
 * If we have `>= threshold` shards, run Shamir `combine` and return the
 * reconstructed bytes. Returns `kind: 'pending'` when more shards are still
 * needed; `kind: 'err'` only on internal failure (e.g. corrupt MMKV row).
 */
export async function reconstructRootSecret(
  vaultId: string
): Promise<ReconstructResult> {
  const pending = await loadRecovery(vaultId);
  if (!pending) {
    return {
      kind: 'err',
      collected: 0,
      threshold: 0,
      reason: 'noShards',
    };
  }
  if (pending.shards.length < pending.threshold) {
    return {
      kind: 'pending',
      collected: pending.shards.length,
      threshold: pending.threshold,
    };
  }
  try {
    const shares: ShamirShare[] = pending.shards.map((s) => ({
      index: s.shardIndex,
      y: base64ToBytes(s.yBase64),
    }));
    const secret = combine(shares);
    return {
      kind: 'ok',
      rootSecret: secret,
      collected: pending.shards.length,
      threshold: pending.threshold,
    };
  } catch {
    return {
      kind: 'err',
      collected: pending.shards.length,
      threshold: pending.threshold,
      reason: 'combineFailed',
    };
  }
}

/** Wipe the pending recovery row. */
export function clearRecoveryState(vaultId: string): void {
  getMmkv().remove(recoveryKey(vaultId));
}

/** Snapshot of the current recovery progress (UI helper). */
export interface RecoverySnapshot {
  readonly vaultId: string;
  readonly threshold: number;
  readonly collected: number;
  readonly ready: boolean;
}

export async function inspectRecovery(
  vaultId: string
): Promise<RecoverySnapshot | null> {
  const pending = await loadRecovery(vaultId);
  if (!pending) return null;
  return {
    vaultId,
    threshold: pending.threshold,
    collected: pending.shards.length,
    ready: pending.shards.length >= pending.threshold,
  };
}
