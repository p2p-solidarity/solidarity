import { expect, test } from 'bun:test';
import { createPasskeyRegistry, readPasskeyCount, type PasskeyRow } from '../../src/identity/passkeyRegistry';

function memory() {
  const values = new Map<string, string>();
  return { values, getString: (key: string) => values.get(key), set: (key: string, value: string) => { values.set(key, value); } };
}
const row: PasskeyRow = { binding: 'alice', credentialId: 'AQID', locator: 'locator', createdAt: '2026-09-23T00:00:00.000Z', device: 'iPhone', platform: 'ios', attachment: 'platform', aaguid: null, status: 'pending' };

test('records pending before upload and marks synced without changing metadata', () => {
  const registry = createPasskeyRegistry(memory());
  expect(registry.save(row).ok).toBe(true);
  expect(registry.list('alice', false)).toEqual({ ok: true, value: [row] });
  expect(registry.save({ ...row, status: 'synced' }).ok).toBe(true);
  expect(registry.list('alice', true)).toEqual({ ok: true, value: [{ ...row, status: 'synced' }] });
});

test('filters identities and retains hidden IDs in exclusion requests', () => {
  const registry = createPasskeyRegistry(memory());
  registry.save(row);
  registry.save({ ...row, binding: 'bob', credentialId: 'BAUG' });
  expect(registry.list('bob', false)).toEqual({ ok: true, value: [{ ...row, binding: 'bob', credentialId: 'BAUG' }] });
  registry.hide('alice', row.credentialId);
  expect(registry.list('alice', true)).toEqual({ ok: true, value: [] });
  expect(registry.excludeCredentialIds('alice')).toEqual({ ok: true, value: ['AQID'] });
});

test('offers exactly one honest legacy row and a binding-scoped legacy tombstone', () => {
  const registry = createPasskeyRegistry(memory());
  expect(registry.list('alice', false)).toEqual({ ok: true, value: [] });
  expect(registry.list('alice', true)).toEqual({ ok: true, value: [{ binding: 'alice', legacy: true }] });
  registry.hide('alice', null);
  expect(registry.list('alice', true)).toEqual({ ok: true, value: [] });
  expect(registry.list('bob', true)).toEqual({ ok: true, value: [{ binding: 'bob', legacy: true }] });
});

test('corruption and unreadable storage remain errors, including writes', () => {
  for (const value of ['', '{}', '{', JSON.stringify({ v: 1, rows: [{}], hidden: [] })]) {
    const storage = memory();
    storage.set('identity.passkeys.v1', value);
    const registry = createPasskeyRegistry(storage);
    expect(registry.list('alice', true).ok).toBe(false);
    expect(registry.excludeCredentialIds('alice').ok).toBe(false);
    expect(registry.save(row).ok).toBe(false);
  }
  const registry = createPasskeyRegistry({ getString: () => { throw new Error('unavailable'); }, set: () => {} });
  expect(registry.list('alice', false).ok).toBe(false);
});


test('hub count uses only stored binding and metadata, even for pending and legacy', () => {
  const storage = memory();
  const registry = createPasskeyRegistry(storage);
  const checked = { ...storage, getString: (key: string) => {
    expect(['identity.passkeys.v1', 'identity.rootVaultSync.v2']).toContain(key);
    return storage.getString(key);
  } };
  expect(readPasskeyCount(checked)).toEqual({ ok: true, value: 0 });
  storage.set('identity.rootVaultSync.v2', JSON.stringify({ v: 2, status: 'connected', binding: 'alice' }));
  expect(readPasskeyCount(checked)).toEqual({ ok: true, value: 1 });
  registry.save(row);
  registry.save({ ...row, binding: 'bob', credentialId: 'BAUG' });
  expect(readPasskeyCount(checked)).toEqual({ ok: true, value: 1 });
  registry.hide('alice', row.credentialId);
  expect(readPasskeyCount(checked)).toEqual({ ok: true, value: 0 });
  storage.set('identity.passkeys.v1', 'corrupt');
  expect(readPasskeyCount(checked).ok).toBe(false);
});
