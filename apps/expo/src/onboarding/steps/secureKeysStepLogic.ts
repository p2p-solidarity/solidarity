/**
 * SecureKeysStep — pure wait-for-sync policy (T7), split out like
 * `backupStepLogic.ts` so the bounded-wait behaviour is unit-testable
 * without React Native or the native keystore.
 *
 * Why this exists: on a fresh device whose root identity was just recovered
 * from iCloud (`restoredFromICloud`), the user's signing key is known to
 * exist in iCloud Keychain but may not have replicated locally yet.
 * `ensureSigningKey()` GENERATES on a miss, which mints a competitor key —
 * the T7 double-mint. This wait gives replication a bounded window first.
 * The caller still calls `ensureSigningKey()` afterwards no matter the
 * outcome: key existence at the end of the step is a hard guarantee (user
 * decision 2026-07-17), the wait only shrinks the race window. Note per
 * A1.5: there is deliberately NO "is iCloud Keychain enabled" availability
 * check — no public API exists; the probe polls actual key presence only.
 */

export type SyncWaitOutcome = 'found' | 'timeout' | 'aborted';

export interface SyncWaitOptions {
  /** Total probe attempts (first probe is immediate). */
  readonly attempts: number;
  /** Delay between probes. */
  readonly intervalMs: number;
  /** Non-minting key-presence probe (`hasExistingSigningKey`). */
  readonly probe: () => Promise<boolean>;
  readonly sleep: (ms: number) => Promise<void>;
  /** Return false to abort early (e.g. the step unmounted). */
  readonly shouldContinue?: () => boolean;
}

export async function waitForSyncedSigningKey(opts: SyncWaitOptions): Promise<SyncWaitOutcome> {
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    if (opts.shouldContinue && !opts.shouldContinue()) return 'aborted';
    if (await opts.probe()) return 'found';
    if (attempt < opts.attempts - 1) await opts.sleep(opts.intervalMs);
  }
  if (opts.shouldContinue && !opts.shouldContinue()) return 'aborted';
  return 'timeout';
}
