/**
 * Time lock — mirror of solidarity/Models/Vault/TimeLockConfig.swift.
 *
 * The Swift model has three lock kinds that combine: a fixed unlock date,
 * an inactivity-day threshold, and an emergency-recovery shard pool. We
 * collapse those into one configuration object with the same shape so a
 * Swift-encoded config round-trips byte-equal (ignoring `status`, which is
 * a runtime concern computed from the other fields).
 *
 * Codable JSON keys (must match Swift `CodingKeys`):
 *   - enabled            : boolean
 *   - unlockDate         : ISO-8601 string or null
 *   - inactivityDays     : Int or null
 *   - beneficiaryContactId : UUID string or null
 *   - witnessContactIds  : [UUID string]
 *   - keyShards          : [EncryptedKeyShard]  (kept opaque here)
 *   - requiredShardCount : Int
 *   - status             : TimeLockStatus enum string
 *
 * The lock policy is intentionally per-item, persisted alongside the
 * VaultItem entry in `store.ts`. This module is pure functions + a Zod
 * schema for runtime validation.
 */
import { z } from 'zod';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  trackLocalDataOperation,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

export const TIME_LOCK_STATUSES = [
  'locked',
  'unlocked',
  'pendingReview',
  'released',
  'failed',
] as const;
export type TimeLockStatus = (typeof TIME_LOCK_STATUSES)[number];

export const encryptedKeyShardSchema = z.object({
  id: z.string(),
  shardIndex: z.number().int(),
  /** Base64 of the wrapped envelope bytes (Swift Data = base64 over the wire). */
  encryptedData: z.string(),
  recipientContactId: z.string(),
  createdAt: z.string(),
  isDistributed: z.boolean(),
  acknowledgedAt: z.string().nullable().optional(),
});
export type EncryptedKeyShard = z.infer<typeof encryptedKeyShardSchema>;

export const timeLockConfigSchema = z.object({
  enabled: z.boolean(),
  unlockDate: z.string().nullable().optional(),
  inactivityDays: z.number().int().nullable().optional(),
  beneficiaryContactId: z.string().nullable().optional(),
  witnessContactIds: z.array(z.string()).default([]),
  keyShards: z.array(encryptedKeyShardSchema).default([]),
  requiredShardCount: z.number().int().min(2).default(2),
  status: z.enum(TIME_LOCK_STATUSES).default('locked'),
});
export type TimeLockConfig = z.infer<typeof timeLockConfigSchema>;

/** Default config — disabled, status=locked, no shards. */
export function defaultTimeLockConfig(): TimeLockConfig {
  return {
    enabled: false,
    unlockDate: null,
    inactivityDays: null,
    beneficiaryContactId: null,
    witnessContactIds: [],
    keyShards: [],
    requiredShardCount: 2,
    status: 'locked',
  };
}

export interface UnlockEvaluation {
  readonly unlocked: boolean;
  /** Earliest moment in the future this lock will unlock, if known. */
  readonly nextUnlockAt: number | null;
  readonly reason: 'disabled' | 'dateReached' | 'inactivity' | 'locked';
}

/**
 * Pure check — `true` when the item should be readable right now.
 *
 * Note: Swift's `isCurrentlyLocked` returns `true` once enabled, regardless
 * of inactivity (inactivity is evaluated by InactivityMonitorService at
 * day-granularity). For ergonomic parity we expose `isUnlocked` as the
 * negation, and accept an optional `daysSinceLastActivity` so callers
 * (the InactivityMonitor in TS) can fold inactivity into the check.
 */
export function isUnlocked(
  config: TimeLockConfig,
  now: number = Date.now(),
  daysSinceLastActivity?: number
): boolean {
  if (!config.enabled) return true;
  if (config.unlockDate) {
    const unlockMs = Date.parse(config.unlockDate);
    if (!Number.isNaN(unlockMs) && now >= unlockMs) return true;
  }
  if (
    typeof config.inactivityDays === 'number' &&
    typeof daysSinceLastActivity === 'number' &&
    daysSinceLastActivity >= config.inactivityDays
  ) {
    return true;
  }
  return false;
}

/** When will the lock open next? Null for inactivity-only or disabled. */
export function nextUnlockAt(config: TimeLockConfig): number | null {
  if (!config.enabled) return null;
  if (config.unlockDate) {
    const ms = Date.parse(config.unlockDate);
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
}

/** Combined evaluation for UI hooks (Rule 8 ready surface). */
export function evaluateTimeLock(
  config: TimeLockConfig,
  now: number = Date.now(),
  daysSinceLastActivity?: number
): UnlockEvaluation {
  if (!config.enabled) {
    return { unlocked: true, nextUnlockAt: null, reason: 'disabled' };
  }
  const next = nextUnlockAt(config);
  if (next !== null && now >= next) {
    return { unlocked: true, nextUnlockAt: next, reason: 'dateReached' };
  }
  if (
    typeof config.inactivityDays === 'number' &&
    typeof daysSinceLastActivity === 'number' &&
    daysSinceLastActivity >= config.inactivityDays
  ) {
    return { unlocked: true, nextUnlockAt: next, reason: 'inactivity' };
  }
  return { unlocked: false, nextUnlockAt: next, reason: 'locked' };
}

// ── Persistence sidecar ───────────────────────────────────────────────────
//
// Stored alongside the VaultItem so existing VaultItem metadata (which
// doesn't have a `timeLockConfig` field today) doesn't need a migration
// before this lands. The key is `vault.lock:<itemId>`.

const LOCK_PREFIX = 'vault.lock:';

function lockKey(itemId: string): string {
  return `${LOCK_PREFIX}${itemId}`;
}

/** Persist (or clear) a per-item time-lock config. */
export function applyTimeLock(
  itemId: string,
  config: TimeLockConfig | null
): Promise<void> {
  return trackLocalDataOperation(
    applyTimeLockAtEpoch(itemId, config, captureLocalDataEpoch()),
  );
}

async function applyTimeLockAtEpoch(
  itemId: string,
  config: TimeLockConfig | null,
  writeEpoch: LocalDataEpoch,
): Promise<void> {
  if (!canCommitLocalData(writeEpoch)) return;
  if (config === null) {
    getMmkv().remove(lockKey(itemId));
    return;
  }
  const parsed = timeLockConfigSchema.parse(config);
  const encrypted = await encryptJson(parsed);
  if (!canCommitLocalData(writeEpoch)) return;
  getMmkv().set(lockKey(itemId), encrypted);
}

/** Read a per-item config; `null` if no lock is set. */
export async function readTimeLock(itemId: string): Promise<TimeLockConfig | null> {
  const raw = getMmkv().getString(lockKey(itemId));
  if (!raw) return null;
  const parsed = await decryptJson(raw);
  const result = timeLockConfigSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
