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
  newBackupName,
  parseBackupTimestampMs,
  selectNewestBackup,
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

const base = {
  backupEnabled: true,
  autoBackupOnPull: true,
  lastRunAtMs: null as number | null,
  nowMs: 1_000_000,
  cooldownMs: 30_000,
};

describe('shouldRunBackup', () => {
  it('manual always runs, even when disabled', () => {
    expect(shouldRunBackup({ ...base, reason: 'manual', backupEnabled: false }).run).toBe(true);
  });
  it('auto trigger skips when backup disabled', () => {
    expect(shouldRunBackup({ ...base, reason: 'pull', backupEnabled: false })).toEqual({
      run: false,
      skipReason: 'disabled',
    });
  });
  it('pull skips when autoBackupOnPull is off', () => {
    expect(shouldRunBackup({ ...base, reason: 'pull', autoBackupOnPull: false })).toEqual({
      run: false,
      skipReason: 'pull-disabled',
    });
  });
  it('skips inside the cooldown window', () => {
    expect(
      shouldRunBackup({ ...base, reason: 'gesture', lastRunAtMs: 990_000, nowMs: 1_000_000 }),
    ).toEqual({ run: false, skipReason: 'cooldown' });
  });
  it('runs once the cooldown has elapsed', () => {
    expect(
      shouldRunBackup({ ...base, reason: 'gesture', lastRunAtMs: 900_000, nowMs: 1_000_000 }).run,
    ).toBe(true);
  });
});
