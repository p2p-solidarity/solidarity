/**
 * Pure backup-policy helpers — no I/O, unit-testable. Owns the two decisions
 * that were previously wrong/scattered:
 *
 *  1. Which file is the NEWEST backup. The old code used a lexicographic
 *     filename `.sort()` and claimed "fixed-width integers sort
 *     lexicographically == chronologically" — false across digit-count
 *     boundaries (a 9-digit second sorts AFTER a 10-digit one) AND when
 *     Swift-written DECIMAL-seconds `.solbk` files coexist with expo integer
 *     ones. That let `downloadBackup`/`backupMtime` pick a STALE backup.
 *
 *  2. Whether a given trigger should actually run a backup right now
 *     (see `shouldRunBackup`) — previously the People pull-to-refresh backed
 *     up unconditionally, ignoring the user's prefs and racing the rotation.
 */
const BACKUP_PREFIX = 'backup_';
const BACKUP_EXT = '.solbk';

/**
 * Parse the timestamp embedded in a backup filename into epoch milliseconds.
 * Handles expo integer-seconds (`backup_1700000000.solbk`), expo fixed-width
 * ms (`backup_1700000000123.solbk`), and Swift decimal-seconds
 * (`backup_1700000000.123456.solbk`). Returns null when the name is not a
 * parseable backup file.
 */
export function parseBackupTimestampMs(name: string): number | null {
  if (!name.startsWith(BACKUP_PREFIX) || !name.endsWith(BACKUP_EXT)) return null;
  const stamp = name.slice(BACKUP_PREFIX.length, name.length - BACKUP_EXT.length);
  if (!/^\d+(\.\d+)?$/.test(stamp)) return null;
  const value = Number(stamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  // >= 1e12 → already milliseconds; otherwise seconds (incl. Swift decimal).
  return value >= 1e12 ? Math.round(value) : Math.round(value * 1000);
}

/**
 * Backup filenames oldest→newest by parsed timestamp. Unparseable names sort
 * first (treated as oldest) with a stable string tiebreak, so rotation still
 * drops them before any real backup.
 */
export function sortBackupsByTimestamp(names: readonly string[]): string[] {
  return [...names].sort((a, b) => {
    const ta = parseBackupTimestampMs(a);
    const tb = parseBackupTimestampMs(b);
    if (ta === null && tb === null) return a < b ? -1 : a > b ? 1 : 0;
    if (ta === null) return -1;
    if (tb === null) return 1;
    if (ta !== tb) return ta - tb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** The newest backup filename, or null when none present. */
export function selectNewestBackup(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  const sorted = sortBackupsByTimestamp(names);
  return sorted[sorted.length - 1] ?? null;
}

/**
 * New backup filename using fixed-width epoch milliseconds — avoids the
 * same-second collision the integer-seconds name had, and stays parseable by
 * `parseBackupTimestampMs`. `nowMs` is injected for testability.
 */
export function newBackupName(nowMs: number): string {
  return `${BACKUP_PREFIX}${Math.floor(nowMs)}${BACKUP_EXT}`;
}

export type BackupReason = 'manual' | 'pull' | 'gesture' | 'onboarding';

export interface BackupPolicyInput {
  readonly reason: BackupReason;
  readonly backupEnabled: boolean;
  readonly autoBackupOnPull: boolean;
  readonly lastRunAtMs: number | null;
  readonly nowMs: number;
  readonly cooldownMs: number;
}

export interface BackupDecision {
  readonly run: boolean;
  readonly skipReason?: 'disabled' | 'pull-disabled' | 'cooldown';
}

/**
 * Single source of truth for "should this trigger back up now?". Manual
 * backups always run (the user pressed the button); automatic triggers respect
 * `backupEnabled`, the pull pref, and a shared cooldown so the (previously
 * uncoordinated) triggers can't churn or race the rotation.
 */
export function shouldRunBackup(input: BackupPolicyInput): BackupDecision {
  if (input.reason === 'manual') return { run: true };
  if (!input.backupEnabled) return { run: false, skipReason: 'disabled' };
  if (input.reason === 'pull' && !input.autoBackupOnPull) {
    return { run: false, skipReason: 'pull-disabled' };
  }
  if (
    input.lastRunAtMs !== null &&
    input.nowMs - input.lastRunAtMs < input.cooldownMs
  ) {
    return { run: false, skipReason: 'cooldown' };
  }
  return { run: true };
}
