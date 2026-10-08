import { expect, test } from 'bun:test';
import { newSyncState, parseSyncState, synchronize, type SyncPorts, type SyncState } from '../../src/backup/syncEngine';
import { emptySyncDocument, type Snapshot, type SyncDocument } from '../../src/backup/syncModel';

test('two devices propagate additions, edits and deletions through repeated cloud rounds', async () => {
  const cloud: SyncDocument[] = [];
  function device(id: string, initial: Snapshot) {
    let local = initial, state = newSyncState('identity', id);
    const ports: SyncPorts = {
      load: () => state, snapshot: async () => local, persist: (s) => { state = s; },
      pull: async () => cloud, push: async (doc) => { cloud.push(doc); },
      apply: async (data, _, s) => { local = data; state = s; }, assertCurrent: () => {},
    };
    return { ports, read: () => local, edit: (s: Snapshot) => { local = s; } };
  }
  const a = device('a', { alice: 'Alice' }), b = device('b', { bob: 'Bob' });
  await synchronize(a.ports); await synchronize(b.ports); await synchronize(a.ports);
  expect(a.read()).toEqual(b.read());
  a.edit({ bob: 'Bobby' });
  await synchronize(a.ports); await synchronize(b.ports);
  expect(b.read()).toEqual({ bob: 'Bobby' });
});

test('an upload failure retains the local revision for retry', async () => {
  let state = newSyncState('identity', 'a');
  const ports: SyncPorts = {
    load: () => state, snapshot: async () => ({ name: 'A' }), persist: (s) => { state = s; },
    pull: async () => [], push: async () => { throw new Error('offline'); },
    apply: async () => { throw new Error('must not apply'); }, assertCurrent: () => {},
  };
  await expect(synchronize(ports)).rejects.toThrow('offline');
  expect(state.unpublished).toBe(true);
  expect(state.document.clock['a']).toBe(1);
  await expect(synchronize(ports)).rejects.toThrow('offline');
  expect(state.document.clock['a']).toBe(1);
});

test('persisted sync state rejects an unsafe device id before reconciliation', () => {
  expect(() => parseSyncState({
    device: '__proto__',
    unpublished: false,
    document: emptySyncDocument('identity'),
  }, 'identity')).toThrow('invalid-local-sync-state');
});

/** A restore is an explicit choice of content, so it must beat whatever the
 * other device holds — and beat it the same way regardless of which random
 * device ids the two installs happen to have. The hazard is a device with NO
 * prior sync state (a fresh install, or one restored after a wipe): its
 * records are authored under a clock concurrent with the peer's, so without an
 * explicit adoption the winner is decided by device-id ordering. */
function cloudPair(idA: string, idB: string) {
  const cloud = new Map<string, SyncDocument>();
  function device(id: string, initial: Snapshot) {
    let local = initial, state: SyncState = newSyncState('identity', id);
    const ports: SyncPorts = {
      load: () => state, snapshot: async () => local, persist: (s) => { state = s; },
      pull: async () => [...cloud.values()], push: async (doc) => { cloud.set(id, doc); },
      apply: async (data, _before, s) => { local = data; state = s; }, assertCurrent: () => {},
    };
    return {
      ports, read: () => local,
      edit: (s: Snapshot) => { local = s; },
      restore: (s: Snapshot, keys: readonly string[]) => { local = s; state = { ...state, adopt: keys }; },
    };
  }
  return { a: device(idA, {}), b: device(idB, {}) };
}

test('a restore on a fresh device wins on both devices, whichever device ids are in play', async () => {
  const outcome = async (idA: string, idB: string) => {
    const { a, b } = cloudPair(idA, idB);
    // B already holds the account and has moved on since the archive.
    b.edit({ 'contacts:x': 'v1-newer-on-b' });
    await synchronize(b.ports);

    // A is a fresh install: no sync state at all, restoring the older archive.
    a.restore({ 'contacts:x': 'v0-archived' }, ['contacts:x']);
    await synchronize(a.ports); await synchronize(b.ports); await synchronize(a.ports);
    return [a.read(), b.read()];
  };
  const archived = { 'contacts:x': 'v0-archived' };
  expect(await outcome('aaaa-device', 'zzzz-device')).toEqual([archived, archived]);
  expect(await outcome('zzzz-device', 'aaaa-device')).toEqual([archived, archived]);
});

test('a restore does not delete records added after the archive was written', async () => {
  const { a, b } = cloudPair('a-device', 'b-device');
  b.edit({ 'contacts:x': 'v0-archived', 'contacts:z': 'added-after-the-backup' });
  await synchronize(b.ports);

  // The archive predates contacts:z, so restoring it adopts only contacts:x.
  a.restore({ 'contacts:x': 'v0-archived' }, ['contacts:x']);
  await synchronize(a.ports); await synchronize(b.ports); await synchronize(a.ports);

  expect(a.read()['contacts:z']).toBe('added-after-the-backup');
  expect(b.read()['contacts:z']).toBe('added-after-the-backup');
});
