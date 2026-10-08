import { expect, test } from 'bun:test';
import { base64UrlEncode } from '@solidarity/shared';
import { connectRootIdentityToPasskey } from '../../src/identity/rootVaultSync';
import { createPasskeyRegistry } from '../../src/identity/passkeyRegistry';

const mnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

test('shared connection records pending before PUT and synced after, passing all exclusions', async () => {
  const values = new Map<string, string>();
  const registry = createPasskeyRegistry({ getString: key => values.get(key), set: (key, value) => { values.set(key, value); } });
  let pendingMetadata: unknown;
  const result = await connectRootIdentityToPasskey({
    mnemonic, userName: 'Solidarity', excludeCredentialIds: ['BAUG'],
    registration: { binding: 'alice', device: 'iPhone', platform: 'ios', registry },
    passkey: { createCredential: async input => {
      expect(input.excludeCredentialIds).toEqual(['BAUG']);
      return { credentialId: 'AQID', prfOutput: base64UrlEncode(new Uint8Array(32).fill(7)), attestationObject: 'garbage' };
    } },
    pending: { set: (_locator, _record, row) => { pendingMetadata = row; }, clear: () => {} },
    upload: { put: async () => {
      const rows = registry.list('alice', false);
      expect(rows.ok && rows.value).toMatchObject([{ status: 'pending', aaguid: null }]);
      expect(pendingMetadata).toMatchObject({ credentialId: 'AQID', status: 'pending' });
      expect(JSON.stringify([...values])).not.toContain('garbage');
      return { ok: true, value: undefined };
    } },
  });
  expect(result.ok).toBe(true);
  const rows = registry.list('alice', true);
  expect(rows.ok && rows.value).toMatchObject([{ status: 'synced' }]);
});
