import { expect, test } from 'bun:test';
import { base64UrlEncode } from '@solidarity/shared';
import { cborEncode } from '@solidarity/shared/qr';
import { passkeyAaguid, passkeyProvider } from '../../src/identity/passkeyAaguid';

test('extracts the AAGUID from attested credential data', () => {
  const authData = new Uint8Array(55);
  authData[32] = 0x40;
  authData.set(Uint8Array.from('fbfc3007154e4ecc8c0b6e020557d7bd'.match(/../g)!.map(x => parseInt(x, 16))), 37);
  const aaguid = passkeyAaguid(base64UrlEncode(cborEncode({ authData })));
  expect(aaguid).toBe('fbfc3007-154e-4ecc-8c0b-6e020557d7bd');
  expect(passkeyProvider(aaguid)).toBe('iCloud Keychain');
});

test('missing, malformed, truncated, zero and unattested data have no provider', () => {
  const withoutAT = new Uint8Array(55).fill(1);
  withoutAT[32] = 0;
  const zero = new Uint8Array(55);
  zero[32] = 0x40;
  for (const authData of [withoutAT, zero, new Uint8Array(52), 'bad']) {
    expect(passkeyAaguid(base64UrlEncode(cborEncode({ authData })))).toBeNull();
  }
  for (const value of [undefined, '', 'garbage', '!!!!']) expect(passkeyAaguid(value)).toBeNull();
  expect(passkeyProvider('00000000-1111-2222-3333-444444444444')).toBeNull();
});
