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
 * How many dated archives the cloud folder keeps. Three is a deliberate
 * product choice (user, 2026-09-08) and only works together with
 * `AUTO_BACKUP_MIN_INTERVAL_HOURS`: an automatic backup that fired on every
 * change would burn all three slots within minutes and leave the user with
 * three snapshots of the same instant — a history that cannot go back.
 */
export const MAX_RETAINED_BACKUPS = 3;

/**
 * The archives to delete so only the newest `keep` survive, oldest first.
 * Pure so retention is unit-testable away from the provider: rotation
 * PERMANENTLY deletes cloud files, and an off-by-one here destroys the user's
 * oldest restore point.
 */
export function selectStaleBackups(names: readonly string[], keep: number): string[] {
  const sorted = sortBackupsByTimestamp(names);
  if (keep <= 0) return sorted;
  return sorted.length <= keep ? [] : sorted.slice(0, sorted.length - keep);
}

/**
 * New backup filename using fixed-width epoch milliseconds — avoids the
 * same-second collision the integer-seconds name had, and stays parseable by
 * `parseBackupTimestampMs`. `nowMs` is injected for testability.
 */
export function newBackupName(nowMs: number): string {
  return `${BACKUP_PREFIX}${Math.floor(nowMs)}${BACKUP_EXT}`;
}

/**
 * The timestamp to name the NEXT archive with, given the last one this process
 * issued. Archive names are millisecond-granular and the native writer
 * replaces a file of the same name, so two archives written inside one
 * millisecond silently collapse into one — now a third of the retained
 * history. Forcing the sequence to strictly increase keeps every archive
 * distinct while staying inside `parseBackupTimestampMs`'s numeric format; a
 * disambiguating suffix would be unparseable, making the file invisible to
 * listing AND to rotation, which is worse than the collision.
 *
 * Pass `lastIssuedMs: 0` for the first archive of a process. Cross-process
 * collisions are moot — a relaunch takes far more than a millisecond.
 */
export function nextBackupNameMs(nowMs: number, lastIssuedMs: number): number {
  return Math.max(Math.floor(nowMs), lastIssuedMs + 1);
}

export type BackupReason = 'manual' | 'auto' | 'pull' | 'gesture' | 'onboarding';

/**
 * Minimum gap between automatic backups, in hours. Fixed, not a preference:
 * the adjustable 6h/12h/daily/weekly schedule (2026-09-08) was cut on
 * 2026-09-10 so the Backup screen is one switch. Six hours is the floor that
 * can coexist with `MAX_RETAINED_BACKUPS` = 3, and the content digest in
 * `autoBackupState` already means an archive is written only when something
 * changed — a shorter gap would buy nothing but churn.
 */
export const AUTO_BACKUP_MIN_INTERVAL_HOURS = 6;

export interface BackupPolicyInput {
  readonly reason: BackupReason;
  /** The one switch: on means archives, the automatic schedule and sync. */
  readonly backupEnabled: boolean;
  readonly lastRunAtMs: number | null;
  /** When the newest archive was actually written — survives app restarts,
   *  unlike `lastRunAtMs`, so a relaunch cannot reset the schedule. */
  readonly lastArchiveAtMs: number | null;
  readonly nowMs: number;
  readonly cooldownMs: number;
  readonly minIntervalMs: number;
}

export interface BackupDecision {
  readonly run: boolean;
  readonly skipReason?: 'disabled' | 'cooldown' | 'interval';
}

/**
 * Single source of truth for "should this trigger back up now?". Manual
 * backups always run (the user pressed the button); every automatic trigger
 * respects `backupEnabled` (there is no separate automatic switch — on means
 * automatic), the short anti-churn cooldown, AND the fixed minimum interval.
 *
 * The interval gate is what makes a 3-archive history worth keeping: without
 * it the pull / gesture / change triggers would rotate the oldest restore
 * point out of existence within a couple of minutes.
 */
export function shouldRunBackup(input: BackupPolicyInput): BackupDecision {
  if (input.reason === 'manual') return { run: true };
  if (!input.backupEnabled) return { run: false, skipReason: 'disabled' };
  if (
    input.lastRunAtMs !== null &&
    input.nowMs - input.lastRunAtMs < input.cooldownMs
  ) {
    return { run: false, skipReason: 'cooldown' };
  }
  // A stamp in the FUTURE means the device clock was ahead when it was
  // written and has since been corrected. Treating that as "too soon" would
  // suppress every automatic backup for the whole length of the skew — weeks,
  // silently, with the toggle still on. Treat it as elapsed instead: the run
  // rewrites the stamp with the corrected clock, so the state repairs itself,
  // and the worst case is one extra archive.
  const sinceArchive =
    input.lastArchiveAtMs === null ? null : input.nowMs - input.lastArchiveAtMs;
  if (sinceArchive !== null && sinceArchive >= 0 && sinceArchive < input.minIntervalMs) {
    return { run: false, skipReason: 'interval' };
  }
  return { run: true };
}
