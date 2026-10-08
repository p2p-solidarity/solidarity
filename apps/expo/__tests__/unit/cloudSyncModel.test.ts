import { expect, test } from 'bun:test';
import { conflictingRecords, emptySyncDocument, observeSnapshot, mergeDocuments, materialize, parseSyncDocument, partitionSnapshot } from '../../src/backup/syncModel';

test('two devices converge without dropping independently added contacts', () => {
  const a = observeSnapshot(emptySyncDocument('identity'), 'a', { 'contacts:a': 'Alice' });
  const b = observeSnapshot(emptySyncDocument('identity'), 'b', { 'contacts:b': 'Bob' });
  expect(materialize(mergeDocuments(a, b))).toEqual({ 'contacts:a': 'Alice', 'contacts:b': 'Bob' });
  expect(mergeDocuments(a, b)).toEqual(mergeDocuments(b, a));
});

test('offline stale data and concurrent edits cannot resurrect a deleted contact', () => {
  const original = observeSnapshot(emptySyncDocument('identity'), 'a', { contact: 'old' });
  const removed = observeSnapshot(original, 'a', {});
  const editedOffline = observeSnapshot(original, 'b', { contact: 'offline edit' });
  const merged = mergeDocuments(removed, editedOffline);
  expect(materialize(merged)).toEqual({});
  expect(merged.records['contact']).toHaveLength(2);
  expect(materialize(mergeDocuments(merged, original))).toEqual({});
  const readded = observeSnapshot(merged, 'b', { contact: 'explicit re-add' });
  expect(materialize(mergeDocuments(removed, readded))).toEqual({ contact: 'explicit re-add' });
});

test('merge is associative and idempotent; a fresh edit resolves concurrent versions', () => {
  const initial = emptySyncDocument('identity');
  const a = observeSnapshot(initial, 'a', { profile: 'A' });
  const b = observeSnapshot(initial, 'b', { profile: 'B' });
  const c = observeSnapshot(initial, 'c', { profile: 'C' });
  expect(mergeDocuments(mergeDocuments(a, b), c)).toEqual(mergeDocuments(a, mergeDocuments(b, c)));
  const merged = mergeDocuments(a, b);
  expect(mergeDocuments(merged, merged)).toEqual(merged);
  const resolved = observeSnapshot(merged, 'a', { profile: 'chosen' });
  expect(mergeDocuments(resolved, b).records['profile']).toHaveLength(1);
  expect(() => mergeDocuments(a, emptySyncDocument('another identity'))).toThrow('sync-identity-mismatch');
});

test('explicitly choosing the current winner resolves all concurrent versions', async () => {
  const { resolveSyncConflict } = await import('../../src/backup/syncModel');
  const a = observeSnapshot(emptySyncDocument('identity'), 'a', { profile: 'A' });
  const b = observeSnapshot(emptySyncDocument('identity'), 'b', { profile: 'B' });
  const merged = mergeDocuments(a, b);
  const resolved = resolveSyncConflict(merged, 'a', 'profile', 1);
  expect(resolved.records['profile']).toHaveLength(1);
  expect(mergeDocuments(resolved, merged)).toEqual(resolved);
});

test('parser rejects a version whose author is not its own clock entry', () => {
  expect(() => parseSyncDocument({
    version: 1,
    identity: 'identity',
    clock: { a: 1 },
    records: { profile: [{ clock: { a: 1 }, author: 'toString', value: 'profile' }] },
  }, 'identity')).toThrow('invalid-sync-version');
});

test('parser rejects record keys that can mutate a plain object prototype', () => {
  const raw = JSON.parse(`{"version":1,"identity":"identity","clock":{"a":1},"records":{"__proto__":[{"clock":{"a":1},"author":"a","value":"profile"}]}}`);
  expect(() => parseSyncDocument(raw, 'identity')).toThrow('invalid-sync-record-key');
});

test('devices restored from one backup hold identical values, which is not a conflict', () => {
  const snapshot = { 'contacts:x': '{"id":"x"}', 'contacts:y': '{"id":"y"}' };
  const a = observeSnapshot(emptySyncDocument('identity'), 'a', snapshot);
  const b = observeSnapshot(emptySyncDocument('identity'), 'b', snapshot);
  const merged = mergeDocuments(a, b);
  expect(merged.records['contacts:x']).toHaveLength(2);
  expect(conflictingRecords(merged)).toEqual([]);
  const edited = observeSnapshot(merged, 'b', { ...snapshot, 'contacts:x': '{"id":"x","name":"edited"}' });
  const conflicts = conflictingRecords(mergeDocuments(edited, observeSnapshot(merged, 'a', { ...snapshot, 'contacts:x': '{"id":"x","name":"other"}' })));
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.key).toBe('contacts:x');
  expect(conflicts[0]?.choices.map((choice) => choice.value).sort()).toEqual(['{"id":"x","name":"edited"}', '{"id":"x","name":"other"}']);
});

test('a deletion concurrent with an edit is offered as a distinct recoverable choice', () => {
  const original = observeSnapshot(emptySyncDocument('identity'), 'a', { contact: 'original' });
  const removed = observeSnapshot(original, 'a', {});
  const edited = observeSnapshot(original, 'b', { contact: 'offline edit' });
  const conflicts = conflictingRecords(mergeDocuments(removed, edited));
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]?.choices.map((choice) => choice.value)).toEqual(['offline edit', null]);
});

test('parser rejects clocks and values large enough to wedge later reconciliation', () => {
  const document = (clock: unknown, value: string) => ({
    version: 1, identity: 'identity', clock,
    records: { profile: [{ clock, author: 'a', value }] },
  });
  expect(() => parseSyncDocument(document({ a: Number.MAX_SAFE_INTEGER }, 'x'), 'identity')).toThrow('invalid-sync-clock');
  expect(() => parseSyncDocument(document({ a: 1 }, 'x'.repeat(12_000_001)), 'identity')).toThrow('invalid-sync-version');
  expect(parseSyncDocument(document({ a: 1 }, 'x'), 'identity').records['profile']).toHaveLength(1);
});

test('a record type this build does not understand survives instead of being deleted', () => {
  const isKnown = (key: string) => key.startsWith('contacts:');
  // A newer build publishes a record type this build has never heard of.
  const remote = observeSnapshot(emptySyncDocument('identity'), 'newer', {
    'contacts:a': 'Alice', 'sharing': '{"perCard":{}}',
  });

  // The older build gathers only what it understands. Publishing that as the
  // whole truth reads as "the record is gone" and tombstones the newer
  // device's data — the failure this carry-forward exists to prevent.
  const gathered = { 'contacts:a': 'Alice' };
  expect(materialize(observeSnapshot(remote, 'older', gathered))['sharing']).toBeUndefined();

  const { known, foreign } = partitionSnapshot(materialize(remote), isKnown);
  expect(known).toEqual({ 'contacts:a': 'Alice' });
  expect(foreign).toEqual({ sharing: '{"perCard":{}}' });

  // Carried forward, the pass mints nothing at all and the record is intact.
  const carried = { ...gathered, ...foreign };
  expect(observeSnapshot(remote, 'older', carried)).toBe(remote);
  expect(materialize(observeSnapshot(remote, 'older', carried))['sharing']).toBe('{"perCard":{}}');
});
