import { describe, expect, it } from 'bun:test';

import {
  base64UrlEncode,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  signJwtEs256,
  utf8ToBytes,
} from '@solidarity/shared';

import type { StoredCredential } from '../../src/credentials/store';
import {
  buildVcExportText,
  importCredentialJwts,
  parseVcExportText,
  storedCredentialFromJwt,
  verifyImportedCredential,
} from '../../src/credentials/vcImportExport';

const CREDENTIAL_ID = '33333333-4444-4555-8666-777777777777';
const IAT = 1_779_718_400;
const EXP = 1_782_310_400;

const ISSUER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 5 + 2) & 0xff);
const ISSUER_DID = didKeyFromPublicKey(publicKeyFromPrivate(ISSUER_PRIV));
const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 3 + 1) & 0xff);
const HOLDER_DID = didKeyFromPublicKey(publicKeyFromPrivate(HOLDER_PRIV));

/** A REAL did:key-signed BusinessCard VC (issuer signature verifies). */
function businessCardJwt(id = CREDENTIAL_ID): string {
  return signJwtEs256(
    { alg: 'ES256', kid: `${ISSUER_DID}#0` },
    {
      jti: `urn:uuid:${id}`,
      iss: ISSUER_DID,
      sub: HOLDER_DID,
      iat: IAT,
      exp: EXP,
      vc: {
        type: ['VerifiableCredential', 'BusinessCardCredential'],
        credentialSubject: {
          id: HOLDER_DID,
          subject_core: { name: 'Ada Lovelace', businessCardId: 'card-1' },
        },
      },
    },
    ISSUER_PRIV,
  );
}

/** Same claims, but the signature bytes are corrupted → must NOT verify. */
function tamperedSignatureJwt(id = CREDENTIAL_ID): string {
  const good = businessCardJwt(id);
  const parts = good.split('.');
  // Flip the signature to a different (valid-length) base64url blob.
  parts[2] = base64UrlEncode(new Uint8Array(64).fill(7));
  return parts.join('.');
}

/** Well-formed JWT, but the issuer DID method is one we cannot verify. */
function didWebIssuerJwt(id = CREDENTIAL_ID): string {
  return signJwtEs256(
    { alg: 'ES256', kid: 'did:web:issuer.example#0' },
    {
      jti: `urn:uuid:${id}`,
      iss: 'did:web:issuer.example',
      sub: HOLDER_DID,
      iat: IAT,
      exp: EXP,
      vc: {
        type: ['VerifiableCredential', 'BusinessCardCredential'],
        credentialSubject: { id: HOLDER_DID, subject_core: { name: 'Ada Lovelace' } },
      },
    },
    // Signed by SOME key — but no did:web resolution exists locally to check it.
    ISSUER_PRIV,
  );
}

describe('VC import/export helpers', () => {
  it('round-trips the Swift-compatible JSON wrapper', () => {
    const jwt = businessCardJwt();
    const text = buildVcExportText([jwt]);

    expect(parseVcExportText(text)).toEqual([jwt]);
  });

  it('derives a stored credential from a BusinessCardCredential JWT', () => {
    const stored = storedCredentialFromJwt(businessCardJwt());

    expect(stored).toMatchObject({
      id: CREDENTIAL_ID,
      type: 'business_card',
      title: 'Ada Lovelace',
      issuerDid: ISSUER_DID,
      holderDid: HOLDER_DID,
      trustLevel: 'L1',
      issuedAt: new Date(IAT * 1000),
      expiresAt: new Date(EXP * 1000),
      metadataTags: ['jwt_vc_json', 'imported', 'did:key'],
    });
  });

  it('imports only new, signature-VERIFIED credentials by id', async () => {
    const added: StoredCredential[] = [];
    const fresh = businessCardJwt('fresh');

    const result = await importCredentialJwts(
      [businessCardJwt(), businessCardJwt(), fresh],
      {
        existingIds: [CREDENTIAL_ID],
        addCredential: (credential) => {
          added.push(credential);
          return Promise.resolve();
        },
      },
    );

    expect(result).toEqual({ imported: 1, skipped: 2, rejected: 0, unverified: 0 });
    expect(added.map((credential) => credential.id)).toEqual(['fresh']);
    // The imported credential is trusted (no `unverified` tag).
    expect(added[0]?.metadataTags).not.toContain('unverified');
  });
});

describe('VC import — signature verification is required before trust', () => {
  it('reports a valid did:key credential as verified', () => {
    expect(verifyImportedCredential(businessCardJwt())).toBe('verified');
  });

  it('reports a tampered signature as invalid', () => {
    expect(verifyImportedCredential(tamperedSignatureJwt())).toBe('invalid');
  });

  it('reports an unsupported issuer DID method as unverified-issuer', () => {
    expect(verifyImportedCredential(didWebIssuerJwt())).toBe('unverified-issuer');
  });

  it('REJECTS a bad-signature VC on import — it never enters the store', async () => {
    const added: StoredCredential[] = [];
    const result = await importCredentialJwts([tamperedSignatureJwt()], {
      addCredential: (credential) => {
        added.push(credential);
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ imported: 0, skipped: 0, rejected: 1, unverified: 0 });
    expect(added).toHaveLength(0);
  });

  it('imports an unsupported-issuer VC as CLEARLY UNVERIFIED, never as trusted', async () => {
    const added: StoredCredential[] = [];
    const result = await importCredentialJwts([didWebIssuerJwt()], {
      addCredential: (credential) => {
        added.push(credential);
        return Promise.resolve();
      },
    });

    expect(result).toEqual({ imported: 1, skipped: 0, rejected: 0, unverified: 1 });
    const stored = added[0];
    expect(stored?.metadataTags).toContain('unverified');
    // Not cryptographically checked → floored trust.
    expect(stored?.trustLevel).toBe('L1');
  });
});
