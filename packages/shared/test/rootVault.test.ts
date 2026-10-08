import { describe, expect, test } from 'bun:test';

import { deriveSecp256k1Scalar, HKDF_INFO_NOSTR } from '../src/derive';
import { openRootVault, rootVaultLocator, sealRootVault } from '../src/rootVault';

const MNEMONIC =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const CREDENTIAL_ID = new Uint8Array([1, 2, 3, 4, 5]);
const PRF_OUTPUT = new Uint8Array(32).fill(7);
const NONCE = new Uint8Array(12).fill(9);

describe('root vault', () => {
  test('round-trips only the mnemonic through a credential-bound ciphertext record', () => {
    const sealed = sealRootVault(
      MNEMONIC,
      CREDENTIAL_ID,
      PRF_OUTPUT,
      NONCE
    );

    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    expect(Object.keys(sealed.value).sort()).toEqual(['ciphertext', 'v']);
    expect(sealed.value.v).toBe(1);
    expect(sealed.value.ciphertext).not.toContain('legal');
    expect(rootVaultLocator(CREDENTIAL_ID)).not.toContain('AQIDBAU');

    expect(openRootVault(sealed.value, CREDENTIAL_ID, PRF_OUTPUT)).toEqual({
      ok: true,
      value: { mnemonic: MNEMONIC },
    });
  });

  test('round-trips an independently imported Nostr signing key inside the ciphertext', () => {
    const nostrScalar = deriveSecp256k1Scalar(MNEMONIC, HKDF_INFO_NOSTR);
    const sealed = sealRootVault(
      MNEMONIC,
      CREDENTIAL_ID,
      PRF_OUTPUT,
      NONCE,
      nostrScalar,
    );
    if (!sealed.ok) throw new Error('fixture failed to seal');

    expect(sealed.value.ciphertext).not.toContain('nostrKey');
    expect(openRootVault(sealed.value, CREDENTIAL_ID, PRF_OUTPUT)).toEqual({
      ok: true,
      value: { mnemonic: MNEMONIC, nostrScalar },
    });
  });

  test('fails closed when a different credential or PRF output is used', () => {
    const sealed = sealRootVault(MNEMONIC, CREDENTIAL_ID, PRF_OUTPUT, NONCE);
    if (!sealed.ok) throw new Error('fixture failed to seal');

    expect(
      openRootVault(
        sealed.value,
        new Uint8Array([9, 8, 7]),
        PRF_OUTPUT
      )
    ).toEqual({ ok: false, error: { kind: 'decryptFailed' } });
    expect(
      openRootVault(sealed.value, CREDENTIAL_ID, new Uint8Array(32).fill(8))
    ).toEqual({ ok: false, error: { kind: 'decryptFailed' } });
  });

  test('rejects invalid mnemonic and PRF inputs before producing ciphertext', () => {
    expect(
      sealRootVault('not a mnemonic', CREDENTIAL_ID, PRF_OUTPUT, NONCE)
    ).toEqual({ ok: false, error: { kind: 'invalidMnemonic' } });
    expect(
      sealRootVault(MNEMONIC, CREDENTIAL_ID, new Uint8Array(31), NONCE)
    ).toEqual({ ok: false, error: { kind: 'invalidPrfOutput' } });
    expect(
      sealRootVault(MNEMONIC, new Uint8Array(), PRF_OUTPUT, NONCE)
    ).toEqual({ ok: false, error: { kind: 'invalidCredential' } });
    expect(
      sealRootVault(
        MNEMONIC,
        CREDENTIAL_ID,
        PRF_OUTPUT,
        NONCE,
        new Uint8Array(32),
      ),
    ).toEqual({ ok: false, error: { kind: 'invalidRecord' } });
  });

  test('rejects records with extra plaintext metadata', () => {
    const sealed = sealRootVault(MNEMONIC, CREDENTIAL_ID, PRF_OUTPUT, NONCE);
    if (!sealed.ok) throw new Error('fixture failed to seal');

    expect(
      openRootVault(
        { ...sealed.value, did: 'did:key:must-not-be-stored' },
        CREDENTIAL_ID,
        PRF_OUTPUT
      )
    ).toEqual({ ok: false, error: { kind: 'invalidRecord' } });
  });
});
