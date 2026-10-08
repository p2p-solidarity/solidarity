import { beforeAll, beforeEach, expect, mock, test } from 'bun:test';

const values = new Map<string, string>();

beforeAll(async () => {
  await mock.module('expo-file-system/legacy', () => ({
    documentDirectory: 'file:///documents/',
    EncodingType: { Base64: 'base64' },
  }));
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (key: string): string | undefined => values.get(key),
      set: (key: string, value: string): void => { values.set(key, value); },
      remove: (key: string): void => { values.delete(key); },
      getAllKeys: (): string[] => Array.from(values.keys()),
    }),
  }));
  await mock.module('@/storage/secureMasterKey', () => ({
    getMasterKey: async () => new Uint8Array(32),
  }));
});

beforeEach(() => {
  values.clear();
});

test('boot recovery rolls back a partially applied portable-data commit', async () => {
  const journalKey = 'cloud-sync:rollback:v1';
  values.set('profile:v1', 'half-applied-profile');
  values.set('contacts:new', 'half-applied-contact');
  values.set(journalKey, JSON.stringify({
    'profile:v1': 'previous-profile',
    'contacts:new': null,
  }));

  const { recoverPortableCommit } = await import('../../src/backup/portableStorage');
  recoverPortableCommit();

  expect(values.get('profile:v1')).toBe('previous-profile');
  expect(values.has('contacts:new')).toBe(false);
  expect(values.has(journalKey)).toBe(false);
});

test('an unreadable journal is dropped instead of aborting every future boot', async () => {
  const journalKey = 'cloud-sync:rollback:v1';
  values.set('profile:v1', 'committed-profile');
  values.set(journalKey, '{"profile:v1": "truncated');

  const { recoverPortableCommit } = await import('../../src/backup/portableStorage');
  expect(() => { recoverPortableCommit(); }).not.toThrow();

  expect(values.has(journalKey)).toBe(false);
  expect(values.get('profile:v1')).toBe('committed-profile');
});

test('a journal with non-string entries is refused rather than half-applied', async () => {
  const journalKey = 'cloud-sync:rollback:v1';
  values.set('profile:v1', 'committed-profile');
  values.set(journalKey, JSON.stringify({ 'profile:v1': 'previous-profile', 'contacts:x': 7 }));

  const { recoverPortableCommit } = await import('../../src/backup/portableStorage');
  recoverPortableCommit();

  expect(values.get('profile:v1')).toBe('committed-profile');
  expect(values.has(journalKey)).toBe(false);
});

test('an avatar path from a previous install container is unavailable, not deleted', async () => {
  values.set('profile:local-avatar:v1', 'file:///previous-container/profile-avatar/avatar-1');

  const { gatherPortableData } = await import('../../src/backup/portableStorage');
  const unavailable = new Set<string>();
  const gathered = await gatherPortableData('did:key:test', unavailable);

  expect(gathered.records['avatar']).toBeUndefined();
  expect([...unavailable]).toEqual(['avatar']);
});

test('a synced refresh keeps the existing manifest order, so manifest[0] stays my card', async () => {
  const { inExistingOrder } = await import('../../src/backup/portableStorage');
  const existing = [{ id: 'f47ac10b' }, { id: '0a1b2c3d' }];
  const incoming = [{ id: '0a1b2c3d' }, { id: 'aa000000' }, { id: 'f47ac10b' }];

  expect(inExistingOrder(incoming, existing).map((entry) => entry.id))
    .toEqual(['f47ac10b', '0a1b2c3d', 'aa000000']);
});

test('restoring a legacy cards-only archive cannot erase a newer profile or Page', async () => {
  const { portableWriteKeys } = await import('../../src/backup/portableStorage');
  const before = { 'cards:a': 'old card', profile: 'newer profile', page: 'newer page' };
  const archive = { 'cards:a': 'archived card' };

  expect([...portableWriteKeys(before, archive, false)]).toEqual(['cards:a']);
  // A sync reconciles the whole namespace, so absence there IS a deletion.
  expect([...portableWriteKeys(before, archive, true)].sort())
    .toEqual(['cards:a', 'page', 'profile']);
});

test('an account preference that differs from its default is portable; a default is absence', async () => {
  const { gatherPortableData } = await import('../../src/backup/portableStorage');
  values.set('prefs:v1', JSON.stringify({ shareEmail: true, shareTitle: false, backupEnabled: true }));

  const gathered = await gatherPortableData('did:key:test');

  expect(gathered.records['preference:shareEmail']).toBe('true');
  // shareTitle already IS the app default, so it is represented by absence —
  // a fresh device must not manufacture a conflict just by existing.
  expect(gathered.records['preference:shareTitle']).toBeUndefined();
  // Device-owned settings never travel, whatever their value.
  expect(gathered.records['preference:backupEnabled']).toBeUndefined();
});

test('sync bookkeeping is never portable and never reaches a snapshot', async () => {
  const storage = await import('../../src/backup/portableStorage');
  values.set(storage.SYNC_STATE_KEY, JSON.stringify({ device: 'a', unpublished: false, adopt: ['contacts:x'] }));
  values.set('cloud-sync:rollback:v1', '{}');

  // Two separate contracts depend on this. The auto-backup schedule hashes
  // gathered records to decide whether anything changed, so sync bookkeeping
  // leaking in would make every sync pass look like new user content. And the
  // sync change-listener treats a portable write as a local edit, so a
  // portable sync state would retrigger sync on its own writes forever.
  expect(storage.isPortableStorageKey(storage.SYNC_STATE_KEY)).toBe(false);
  expect(storage.isPortableStorageKey('cloud-sync:rollback:v1')).toBe(false);
  const gathered = await gatherPortableDataFor('did:key:test');
  expect(Object.keys(gathered.records)).toEqual([]);
});

async function gatherPortableDataFor(identity: string) {
  const { gatherPortableData } = await import('../../src/backup/portableStorage');
  return gatherPortableData(identity);
}

test('a page snapshot travels verbatim, timestamps included', async () => {
  const { gatherPortableData } = await import('../../src/backup/portableStorage');
  const id = 'a1b2c3d4e5f6a7b8c9d0e1f2';
  const entry = {
    kind: 'declared', sourceUrl: 'https://example.com/p', title: 'Peer',
    links: [], importedAt: '2026-06-01T00:00:00Z',
  };
  values.set('profileSnapshots:v1', JSON.stringify({ [id]: entry }));

  const record = (await gatherPortableData('did:key:test')).records[`snapshot:${id}`];

  // Decision (2026-09-08): a device receiving a page by sync or by restore
  // shows the OTHER device's check time rather than "never verified", so the
  // observation timestamps travel with the record. Suppressing the 6-hourly
  // re-check churn is a change-DETECTION rule (`isObservationOnlyChange`),
  // never a reason to strip a timestamp from what gets published.
  expect(record).toBeDefined();
  expect(JSON.parse(record!)).toEqual(entry);
});
