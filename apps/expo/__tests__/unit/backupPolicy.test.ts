/**
 * Pure backup-policy helpers — timestamp parsing, chronological newest-backup
 * selection, and the run/skip decision.
 *
 * Regression target: the old lexicographic `.sort()` of integer-seconds
 * filenames was NOT chronological across digit-count boundaries, and broke
 * outright when Swift decimal-seconds `.solbk` files coexisted with expo
 * integer ones — so restore could pick a STALE backup.
 *
 * Run:
 *   cd apps/expo && bun test __tests__/unit/backupPolicy.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  AUTO_BACKUP_INTERVAL_CHOICES,
  AUTO_BACKUP_MIN_INTERVAL_HOURS,
  MAX_RETAINED_BACKUPS,
  newBackupName,
  nextBackupNameMs,
  parseBackupTimestampMs,
  resolveAutoBackupIntervalHours,
  selectNewestBackup,
  selectStaleBackups,
  shouldRunBackup,
  sortBackupsByTimestamp,
} from '../../src/backup/backupPolicy';

describe('parseBackupTimestampMs', () => {
  it('parses expo integer-seconds names to ms', () => {
    expect(parseBackupTimestampMs('backup_1700000000.solbk')).toBe(1_700_000_000_000);
  });
  it('parses expo fixed-width ms names', () => {
    expect(parseBackupTimestampMs('backup_1700000000123.solbk')).toBe(1_700_000_000_123);
  });
  it('parses Swift decimal-seconds names', () => {
    expect(parseBackupTimestampMs('backup_1700000000.5.solbk')).toBe(1_700_000_000_500);
  });
  it('rejects non-backup names', () => {
    expect(parseBackupTimestampMs('notes.txt')).toBeNull();
    expect(parseBackupTimestampMs('backup_.solbk')).toBeNull();
    expect(parseBackupTimestampMs('backup_abc.solbk')).toBeNull();
  });
});

describe('selectNewestBackup', () => {
  it('is chronological across digit-count + format boundaries (the old bug)', () => {
    const names = [
      'backup_999999999.solbk', // 9 digits  → 999,999,999s
      'backup_1700000000.solbk', // 10 digits → 1,700,000,000s
      'backup_1700000000.123456.solbk', // Swift decimal
      'backup_1700000005000.solbk', // ms form, newest
    ];
    expect(selectNewestBackup(names)).toBe('backup_1700000005000.solbk');
  });
  it('returns null for empty input', () => {
    expect(selectNewestBackup([])).toBeNull();
  });
});

describe('sortBackupsByTimestamp', () => {
  it('orders oldest→newest', () => {
    expect(
      sortBackupsByTimestamp(['backup_1700000005000.solbk', 'backup_999999999.solbk']),
    ).toEqual(['backup_999999999.solbk', 'backup_1700000005000.solbk']);
  });
});

describe('newBackupName', () => {
  it('emits a fixed-width ms name that round-trips through the parser', () => {
    const name = newBackupName(1_700_000_000_123);
    expect(name).toBe('backup_1700000000123.solbk');
    expect(parseBackupTimestampMs(name)).toBe(1_700_000_000_123);
  });
});

describe('nextBackupNameMs', () => {
  // Regression (reported by the cloud-sync session, 2026-09-08): five manual
  // backups with no gap produced only THREE files — the native writer replaces
  // a same-named file, so pairs landing in one millisecond overwrote each
  // other. With only MAX_RETAINED_BACKUPS kept, each collision costs a third
  // of the user's history.
  it('never issues the same millisecond twice, even with a frozen clock', () => {
    const frozen = 1_700_000_000_000;
    const issued: number[] = [];
    let last = 0;
    for (let i = 0; i < 5; i += 1) {
      last = nextBackupNameMs(frozen, last);
      issued.push(last);
    }
    expect(issued).toEqual([
      frozen, frozen + 1, frozen + 2, frozen + 3, frozen + 4,
    ]);
    expect(new Set(issued.map(newBackupName)).size).toBe(5);
  });

  it('follows the real clock once it has moved past the mark', () => {
    expect(nextBackupNameMs(1_700_000_010_000, 1_700_000_000_003)).toBe(1_700_000_010_000);
  });

  it('keeps names strictly increasing when the clock jumps backwards', () => {
    // A corrected clock must never re-issue a name that already exists, or the
    // new archive would silently replace an older, still-wanted one.
    const last = 1_700_000_000_010;
    const next = nextBackupNameMs(1_600_000_000_000, last);
    expect(next).toBe(last + 1);
    expect(next).toBeGreaterThan(last);
  });

  it('emits names that still round-trip through the parser', () => {
    const ms = nextBackupNameMs(1_700_000_000_000, 1_700_000_000_000);
    expect(parseBackupTimestampMs(newBackupName(ms))).toBe(ms);
  });
});

const base = {
  backupEnabled: true,
  autoBackupEnabled: true,
  lastRunAtMs: null as number | null,
  lastArchiveAtMs: null as number | null,
  nowMs: 1_000_000,
  cooldownMs: 30_000,
  minIntervalMs: 6 * 3_600_000,
};

describe('shouldRunBackup', () => {
  it('manual always runs, even when disabled', () => {
    expect(shouldRunBackup({ ...base, reason: 'manual', backupEnabled: false }).run).toBe(true);
  });
  it('manual ignores the interval — the user pressed the button', () => {
    expect(
      shouldRunBackup({ ...base, reason: 'manual', lastArchiveAtMs: base.nowMs - 1_000 }).run,
    ).toBe(true);
  });
  it('auto trigger skips when backup disabled', () => {
    expect(shouldRunBackup({ ...base, reason: 'pull', backupEnabled: false })).toEqual({
      run: false,
      skipReason: 'disabled',
    });
  });
  it('every non-manual trigger skips when automatic backup is off', () => {
    for (const reason of ['auto', 'pull', 'gesture'] as const) {
      expect(shouldRunBackup({ ...base, reason, autoBackupEnabled: false })).toEqual({
        run: false,
        skipReason: 'auto-disabled',
      });
    }
  });
  it('skips inside the cooldown window', () => {
    expect(
      shouldRunBackup({ ...base, reason: 'gesture', lastRunAtMs: 990_000, nowMs: 1_000_000 }),
    ).toEqual({ run: false, skipReason: 'cooldown' });
  });
  it('runs once the cooldown has elapsed and no archive exists yet', () => {
    expect(
      shouldRunBackup({ ...base, reason: 'gesture', lastRunAtMs: 900_000, nowMs: 1_000_000 }).run,
    ).toBe(true);
  });

  // The interval gate is what makes a MAX_RETAINED_BACKUPS-deep history worth
  // keeping: without it, repeated pulls/gestures rotate every restore point
  // out within minutes.
  it('skips an automatic run inside the chosen interval', () => {
    const now = 100 * 3_600_000;
    expect(
      shouldRunBackup({
        ...base,
        reason: 'auto',
        nowMs: now,
        lastArchiveAtMs: now - 5 * 3_600_000,
      }),
    ).toEqual({ run: false, skipReason: 'interval' });
  });
  it('runs an automatic backup once the interval has elapsed', () => {
    const now = 100 * 3_600_000;
    expect(
      shouldRunBackup({
        ...base,
        reason: 'auto',
        nowMs: now,
        lastArchiveAtMs: now - 6 * 3_600_000,
      }).run,
    ).toBe(true);
  });
  it('applies the interval to pull and gesture too, so they cannot churn history', () => {
    const now = 100 * 3_600_000;
    for (const reason of ['pull', 'gesture'] as const) {
      expect(
        shouldRunBackup({ ...base, reason, nowMs: now, lastArchiveAtMs: now - 60_000 }).skipReason,
      ).toBe('interval');
    }
  });
  it('recovers from a future-dated stamp instead of stalling for the skew', () => {
    // Written while the device clock was ahead, then the clock corrected. If
    // this counted as "too soon", automatic backup would go silent for the
    // whole length of the skew with the toggle still on. Running repairs the
    // stamp; the cost is at most one extra archive.
    const now = 100 * 3_600_000;
    for (const skewMs of [1_000, 3_600_000, 60 * 24 * 3_600_000]) {
      expect(
        shouldRunBackup({ ...base, reason: 'auto', nowMs: now, lastArchiveAtMs: now + skewMs }).run,
      ).toBe(true);
    }
  });
});

describe('resolveAutoBackupIntervalHours', () => {
  it('accepts every offered choice unchanged', () => {
    for (const hours of AUTO_BACKUP_INTERVAL_CHOICES) {
      expect(resolveAutoBackupIntervalHours(hours)).toBe(hours);
    }
  });
  it('falls back to the 6h floor for corrupt or out-of-range values', () => {
    // A persisted preference is untrusted input: a 0 must never become a
    // zero-length interval that backs up on every single change.
    for (const bad of [0, -1, 0.5, 3, NaN, null, undefined, '6', {}]) {
      expect(resolveAutoBackupIntervalHours(bad)).toBe(AUTO_BACKUP_MIN_INTERVAL_HOURS);
    }
  });
  it('never offers anything shorter than the floor', () => {
    expect(Math.min(...AUTO_BACKUP_INTERVAL_CHOICES)).toBe(AUTO_BACKUP_MIN_INTERVAL_HOURS);
  });
});

describe('selectStaleBackups', () => {
  // Rotation PERMANENTLY deletes cloud files — an off-by-one here destroys
  // the user's oldest restore point.
  const names = [
    'backup_1700000004000.solbk',
    'backup_1700000001000.solbk',
    'backup_1700000003000.solbk',
    'backup_1700000002000.solbk',
  ];
  it('keeps the newest N and returns the rest oldest-first', () => {
    expect(selectStaleBackups(names, 3)).toEqual(['backup_1700000001000.solbk']);
  });
  it('deletes nothing while at or below the cap', () => {
    expect(selectStaleBackups(names.slice(0, 3), 3)).toEqual([]);
    expect(selectStaleBackups(names.slice(0, 2), 3)).toEqual([]);
    expect(selectStaleBackups([], 3)).toEqual([]);
  });
  it('drops legacy Swift-named archives by age, not by format', () => {
    // A v1 file only opens on the device that wrote it and is superseded by
    // any newer portable archive, so it rotates out like anything else.
    expect(
      selectStaleBackups(
        ['backup_1700000000.123456.solbk', 'backup_1700000009000.solbk'],
        1,
      ),
    ).toEqual(['backup_1700000000.123456.solbk']);
  });
  it('retains three archives by default', () => {
    expect(MAX_RETAINED_BACKUPS).toBe(3);
  });
});
