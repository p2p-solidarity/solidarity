import { expect, test } from 'bun:test';
import { passkeysViewModel } from '../../src/components/passkeys/passkeysViewModel';

test('loading and unreadable lists never offer Add or invented rows', () => {
  expect(passkeysViewModel({ kind: 'loading' }, false)).toEqual({ rows: [], canAdd: false, messageKey: 'passkeys.loading' });
  expect(passkeysViewModel({ kind: 'error' }, false)).toEqual({ rows: [], canAdd: false, messageKey: 'passkeys.loadFailed' });
});

test('empty ready list offers Add; pending rows and busy operations disable it', () => {
  expect(passkeysViewModel({ kind: 'ready', rows: [] }, false).canAdd).toBe(true);
  expect(passkeysViewModel({ kind: 'ready', rows: [] }, true).canAdd).toBe(false);
  expect(passkeysViewModel({ kind: 'ready', rows: [{ binding: 'alice', legacy: true }] }, false).rows).toHaveLength(1);
  const row = { binding: 'alice', credentialId: 'AQID', locator: 'locator', device: 'iPhone', platform: 'ios', createdAt: '2026-09-23', attachment: null, aaguid: null, status: 'pending' as const };
  expect(passkeysViewModel({ kind: 'ready', rows: [row] }, false).canAdd).toBe(false);
  expect(passkeysViewModel({ kind: 'ready', rows: [{ ...row, status: 'synced' }] }, false).canAdd).toBe(true);
});
