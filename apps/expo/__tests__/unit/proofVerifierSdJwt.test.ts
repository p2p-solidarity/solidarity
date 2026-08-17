/**
 * `proofVerifier.ts` SD-JWT awareness (T6). Once presentations stop leaking a
 * full VC and instead emit a REDACTED SD-JWT (only the selected disclosures),
 * the verifier must (a) verify the issuer signature over the issuer segment,
 * (b) reconstruct ONLY the disclosed claims, (c) reject any disclosure the
 * issuer never signed, and (d) still bind the embedded credential's holder to
 * the VP holder. Hand-signed fixtures — `proofVerifier.ts` has no store /
 * keychain deps, same as `proofVerifierHolderBinding.test.ts`.
 */
import { describe, expect, it } from 'bun:test';

import {
  base64UrlEncode,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  sha256Bytes,
  signJwtEs256,
  utf8ToBytes,
} from '@solidarity/shared';

import { verifyVpToken } from '../../src/oidc/proofVerifier';

const ISSUER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 5 + 2) & 0xff);
const ISSUER_DID = didKeyFromPublicKey(publicKeyFromPrivate(ISSUER_PRIV));
const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 3 + 1) & 0xff);
const HOLDER_DID = didKeyFromPublicKey(publicKeyFromPrivate(HOLDER_PRIV));
const OTHER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
const OTHER_DID = didKeyFromPublicKey(publicKeyFromPrivate(OTHER_PRIV));

const NOW = Math.floor(Date.now() / 1000);

function makeDisclosure(salt: string, name: string, value: unknown): string {
  return base64UrlEncode(utf8ToBytes(JSON.stringify([salt, name, value])));
}
function sdDigest(disclosure: string): string {
  return base64UrlEncode(sha256Bytes(utf8ToBytes(disclosure)));
}

interface SdJwtOpts {
  readonly subject?: string;
  readonly exp?: number;
  readonly issuerDid?: string;
  readonly issuerPriv?: Uint8Array;
  readonly disclosable?: Record<string, unknown>;
  /** disclosure names to actually PRESENT (subset of disclosable). */
  readonly present?: readonly string[];
}

function buildSdJwt(opts: SdJwtOpts = {}): { combined: string; byName: Record<string, string> } {
  const disclosable = opts.disclosable ?? { age_over_18: true, nationality: 'JP' };
  const issuerDid = opts.issuerDid ?? ISSUER_DID;
  const issuerPriv = opts.issuerPriv ?? ISSUER_PRIV;
  const names = Object.keys(disclosable);
  const disclosures = names.map((name, i) => makeDisclosure(`salt-${i}`, name, disclosable[name]));
  const byName: Record<string, string> = {};
  names.forEach((name, i) => (byName[name] = disclosures[i] as string));

  const payload = {
    iss: issuerDid,
    sub: opts.subject ?? HOLDER_DID,
    iat: NOW,
    exp: opts.exp ?? NOW + 3600,
    _sd_alg: 'sha-256',
    _sd: disclosures.map(sdDigest),
  };
  const issuerJwt = signJwtEs256({ alg: 'ES256', kid: `${issuerDid}#0` }, payload, issuerPriv);
  const present = opts.present ?? names;
  const kept = present.map((n) => byName[n] as string);
  const tail = kept.length > 0 ? `${kept.join('~')}~` : '';
  return { combined: `${issuerJwt}~${tail}`, byName };
}

function signVp(vcJwts: readonly string[], holderPriv = HOLDER_PRIV, holderDid = HOLDER_DID): string {
  return signJwtEs256(
    { alg: 'ES256', typ: 'vp+jwt', kid: `${holderDid}#0` },
    {
      iss: holderDid,
      sub: holderDid,
      iat: NOW,
      exp: NOW + 300,
      vp: {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiablePresentation'],
        holder: holderDid,
        verifiableCredential: vcJwts,
      },
    },
    holderPriv,
  );
}

async function expectRejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    expect(e instanceof Error ? e.message : String(e)).toMatch(pattern);
    return;
  }
  throw new Error('expected promise to reject');
}

describe('verifyVpToken — embedded SD-JWT', () => {
  it('verifies a VP carrying a REDACTED SD-JWT and reconstructs only the disclosed claim', async () => {
    // Issuer signs {age_over_18, nationality}; holder presents only age.
    const { combined } = buildSdJwt({ present: ['age_over_18'] });
    const vp = signVp([combined]);

    const verified = await verifyVpToken(vp);
    expect(verified.holderDid).toBe(HOLDER_DID);
    expect(verified.credentials).toHaveLength(1);
    const claims = verified.credentials[0]?.claims ?? {};
    expect(claims['age_over_18']).toBe(true);
    // Withheld disclosure never reconstructed → the verifier cannot see it.
    expect(claims['nationality']).toBeUndefined();
    // Raw digests never surface as claims.
    expect(claims['_sd']).toBeUndefined();
  });

  it('REJECTS an SD-JWT carrying a disclosure the issuer never signed (altered disclosure)', async () => {
    const { combined } = buildSdJwt({ present: ['age_over_18'] });
    const forged = makeDisclosure('evil', 'is_admin', true);
    const tampered = `${combined}${forged}~`;
    const vp = signVp([tampered]);

    await expectRejectsWith(verifyVpToken(vp), /not signed by the issuer|disclosure/u);
  });

  it('REJECTS an SD-JWT whose subject is a DIFFERENT holder than the VP signer', async () => {
    const { combined } = buildSdJwt({ subject: OTHER_DID, present: ['age_over_18'] });
    const vp = signVp([combined]);

    await expectRejectsWith(verifyVpToken(vp), /different holder/u);
  });

  it('REJECTS an expired SD-JWT even when the outer VP is still valid', async () => {
    const { combined } = buildSdJwt({ exp: NOW - 60, present: ['age_over_18'] });
    const vp = signVp([combined]);

    await expectRejectsWith(verifyVpToken(vp), /expired/u);
  });

  it('REJECTS an SD-JWT from an issuer DID method the verifier cannot resolve', async () => {
    const { combined } = buildSdJwt({
      issuerDid: 'did:web:issuer.example',
      issuerPriv: ISSUER_PRIV,
      present: ['age_over_18'],
    });
    const vp = signVp([combined]);

    await expectRejectsWith(verifyVpToken(vp), /unsupported issuer|did method/iu);
  });

  it('REJECTS an SD-JWT whose issuer signature does not verify', async () => {
    // Issuer segment claims ISSUER_DID but is signed by OTHER_PRIV.
    const { combined } = buildSdJwt({ issuerDid: ISSUER_DID, issuerPriv: OTHER_PRIV });
    const vp = signVp([combined]);

    await expectRejectsWith(verifyVpToken(vp), /signature/iu);
  });
});
