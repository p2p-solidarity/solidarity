/**
 * Persisted auto-backup bookkeeping — the marker that keeps a 6-hour schedule
 * honest across app restarts, and the content digest that stops an unchanged
 * snapshot from evicting the user's real restore points.
 *
 * Both are read back from disk, so both are UNTRUSTED input: a corrupt value
 * must degrade to "nothing recorded" (back up now) rather than to a bogus
 * timestamp that could suppress backups indefinitely.
 *
 * Run:
 *   cd apps/expo && bun test __tests__/unit/autoBackupState.test.ts
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const values = new Map<string, string>();

beforeAll(async () => {
  // portableStorage (imported by one assertion below) reaches for the native
  // file-system + keychain modules at import time.
  await mock.module('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///documents/',
    EncodingType: { Base64: 'base64' },
  }));
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => new Uint8Array(32),
  }));
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (key: string): string | undefined => values.get(key),
      set: (key: string, value: string): void => { values.set(key, value); },
      remove: (key: string): void => { values.delete(key); },
      getAllKeys: (): string[] => Array.from(values.keys()),
    }),
  }));
});

beforeEach(() => { values.clear(); });

const KEY = 'backup:auto-state:v1';
const load = async () => import('../../src/backup/autoBackupState');

describe('readAutoBackupState', () => {
  it('reports nothing recorded on a fresh install', async () => {
    const { readAutoBackupState } = await load();
    expect(readAutoBackupState()).toEqual({ lastArchiveAtMs: null, digest: null });
  });

  it('round-trips a written marker', async () => {
    const { readAutoBackupState, writeAutoBackupState } = await load();
    const digest = 'a'.repeat(64);
    writeAutoBackupState({ lastArchiveAtMs: 1_700_000_000_000, digest });
    expect(readAutoBackupState()).toEqual({ lastArchiveAtMs: 1_700_000_000_000, digest });
  });

  it('fails OPEN on every corrupt shape — an unreadable marker must not suppress backups', async () => {
    const { readAutoBackupState } = await load();
    const corrupt = [
      'not json',
      '[]',
      'null',
      '"string"',
      JSON.stringify({ lastArchiveAtMs: 'yesterday', digest: 5 }),
      JSON.stringify({ lastArchiveAtMs: -1, digest: 'short' }),
      JSON.stringify({ lastArchiveAtMs: 0, digest: 'Z'.repeat(64) }),
      JSON.stringify({}),
    ];
    for (const raw of corrupt) {
      values.set(KEY, raw);
      expect(readAutoBackupState()).toEqual({ lastArchiveAtMs: null, digest: null });
    }
  });

  it('keeps a valid timestamp even when the digest is unusable', async () => {
    const { readAutoBackupState } = await load();
    // Half-valid state still bounds the schedule; only the change check is
    // lost, and losing it costs one redundant archive, never a missed one.
    values.set(KEY, JSON.stringify({ lastArchiveAtMs: 1_700_000_000_000, digest: 'nope' }));
    expect(readAutoBackupState()).toEqual({ lastArchiveAtMs: 1_700_000_000_000, digest: null });
  });

  it('writes under a key the sync engine never reconciles', async () => {
    const { writeAutoBackupState } = await load();
    const { isPortableStorageKey } = await import('../../src/backup/portableStorage');
    writeAutoBackupState({ lastArchiveAtMs: 1, digest: null });
    // A portable key would be wiped by a replace-mode sync and would also make
    // the scheduler's own write look like a user edit.
    expect([...values.keys()].some(isPortableStorageKey)).toBe(false);
  });
});

describe('portableDataDigest', () => {
  const data = (records: Record<string, string>) => ({
    version: 1 as const, identity: 'did:key:zTest', records,
  });

  it('is stable across key insertion order', async () => {
    const { portableDataDigest } = await load();
    expect(portableDataDigest(data({ 'cards:a': '1', 'contacts:b': '2' })))
      .toBe(portableDataDigest(data({ 'contacts:b': '2', 'cards:a': '1' })));
  });

  it('changes when any record value changes', async () => {
    const { portableDataDigest } = await load();
    expect(portableDataDigest(data({ 'cards:a': '1' })))
      .not.toBe(portableDataDigest(data({ 'cards:a': '2' })));
  });

  it('changes when a record is added or removed', async () => {
    const { portableDataDigest } = await load();
    const one = portableDataDigest(data({ 'cards:a': '1' }));
    expect(one).not.toBe(portableDataDigest(data({ 'cards:a': '1', 'cards:b': '1' })));
    expect(one).not.toBe(portableDataDigest(data({})));
  });

  it('emits a 64-char hex digest the state parser will accept', async () => {
    const { portableDataDigest } = await load();
    expect(portableDataDigest(data({ 'cards:a': '1' }))).toMatch(/^[0-9a-f]{64}$/u);
  });

  // Regression: the contact auto-refresh sweep re-resolves every saved
  // Verified Page on a schedule and refreshes `verifiedAt` even when the
  // signed bytes come back identical (people/profileSnapshots.ts →
  // `alreadyCurrent`). Digesting that made "only when something changed" true
  // for nobody with a saved page: an archive every interval, rolling the
  // three retained restore points on a timer instead of on real edits.
  describe('Verified Page snapshots', () => {
    const snapshot = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        kind: 'verified',
        did: 'did:key:zPeer',
        scope: 'full',
        record: { displayName: 'Ada' },
        jws: 'sig-1',
        verifiedAt: '2026-09-08T00:00:00.000Z',
        note: null,
        conflicts: [],
        ...over,
      });

    it('ignores a refreshed verifiedAt — a re-check is not a change', async () => {
      const { portableDataDigest } = await load();
      expect(portableDataDigest(data({ 'snapshot:full:did:key:zPeer': snapshot() }))).toBe(
        portableDataDigest(
          data({
            'snapshot:full:did:key:zPeer': snapshot({ verifiedAt: '2026-09-08T06:00:00.000Z' }),
          }),
        ),
      );
    });

    it('ignores verifiedAt inside retained conflicts too', async () => {
      const { portableDataDigest } = await load();
      const withConflict = (at: string) =>
        snapshot({ conflicts: [{ record: { displayName: 'Ada' }, jws: 'sig-2', verifiedAt: at }] });
      expect(portableDataDigest(data({ 'snapshot:x': withConflict('2026-09-08T00:00:00.000Z') })))
        .toBe(portableDataDigest(data({ 'snapshot:x': withConflict('2026-09-09T00:00:00.000Z') })));
    });

    it('still reacts to the signed content changing', async () => {
      const { portableDataDigest } = await load();
      expect(portableDataDigest(data({ 'snapshot:x': snapshot() }))).not.toBe(
        portableDataDigest(data({ 'snapshot:x': snapshot({ record: { displayName: 'Grace' } }) })),
      );
    });

    it('still reacts to a rotated signature — the peer really republished', async () => {
      const { portableDataDigest } = await load();
      expect(portableDataDigest(data({ 'snapshot:x': snapshot() }))).not.toBe(
        portableDataDigest(data({ 'snapshot:x': snapshot({ jws: 'sig-2' }) })),
      );
    });

    it('does not strip verifiedAt from non-snapshot records', async () => {
      const { portableDataDigest } = await load();
      const a = JSON.stringify({ verifiedAt: 'one' });
      const b = JSON.stringify({ verifiedAt: 'two' });
      expect(portableDataDigest(data({ 'cards:a': a }))).not.toBe(
        portableDataDigest(data({ 'cards:a': b })),
      );
    });

    it('hashes an unparseable snapshot record instead of throwing', async () => {
      const { portableDataDigest } = await load();
      expect(portableDataDigest(data({ 'snapshot:x': 'not json' }))).toMatch(/^[0-9a-f]{64}$/u);
    });
  });
});
