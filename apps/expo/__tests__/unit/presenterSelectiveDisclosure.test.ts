/**
 * `oidc/presenter.ts::buildVpToken` — selective-disclosure honesty (T6). The
 * OID4VP presenter must never embed a full credential when only a SUBSET of
 * its claims was selected:
 *   - ordinary JWT VC + subset  → fail closed (a plain JWT is atomic).
 *   - ordinary JWT VC + full    → embed verbatim.
 *   - real SD-JWT   + subset    → embed a REDACTED SD-JWT (selected only).
 *   - `unverified`-tagged cred  → refuse.
 * Fully dependency-injected — no store / keychain / native load (same seam
 * `pearPresentRoundTrip.test.ts` uses).
 */
import { describe, expect, it } from 'bun:test';

import {
  base64UrlEncode,
  decodeJwtUnsafe,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  sha256Bytes,
  signJwtEs256,
  utf8ToBytes,
} from '@solidarity/shared';

import type { StoredCredential } from '../../src/credentials/store';
import type { ProvableClaimEntity } from '../../src/identity/entities';
import { buildVpToken, type PresentationBuilderDeps } from '../../src/oidc/presenter';
import { buildSyntheticPresentRequest } from '../../src/pear/presentBuilder';
import { verifyVpToken } from '../../src/oidc/proofVerifier';

const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 3 + 1) & 0xff);
const HOLDER_PUB = publicKeyFromPrivate(HOLDER_PRIV);
const HOLDER_DID = didKeyFromPublicKey(HOLDER_PUB);
const HOLDER_JWK = publicKeyToJwk(HOLDER_PUB);
const AUD = 'did:key:zVerifierAudience';
const NOW = Math.floor(Date.now() / 1000);

function makeDisclosure(salt: string, name: string, value: unknown): string {
  return base64UrlEncode(utf8ToBytes(JSON.stringify([salt, name, value])));
}
function sdDigest(d: string): string {
  return base64UrlEncode(sha256Bytes(utf8ToBytes(d)));
}

function plainVc(): string {
  return signJwtEs256(
    { alg: 'ES256', kid: `${HOLDER_DID}#0` },
    {
      iss: HOLDER_DID,
      sub: HOLDER_DID,
      iat: NOW,
      exp: NOW + 3600,
      vc: {
        credentialSubject: { id: HOLDER_DID, name: 'Ada', email: 'ada@example.com' },
      },
    },
    HOLDER_PRIV,
  );
}

function sdVc(disclosable: Record<string, unknown>): { combined: string; byName: Record<string, string> } {
  const names = Object.keys(disclosable);
  const disclosures = names.map((n, i) => makeDisclosure(`s-${i}`, n, disclosable[n]));
  const byName: Record<string, string> = {};
  names.forEach((n, i) => (byName[n] = disclosures[i] as string));
  const issuerJwt = signJwtEs256(
    { alg: 'ES256', kid: `${HOLDER_DID}#0` },
    { iss: HOLDER_DID, sub: HOLDER_DID, iat: NOW, exp: NOW + 3600, _sd_alg: 'sha-256', _sd: disclosures.map(sdDigest) },
    HOLDER_PRIV,
  );
  return { combined: `${issuerJwt}~${disclosures.join('~')}~`, byName };
}

function provable(id: string, cardId: string, claimType: string): ProvableClaimEntity {
  return {
    id,
    identityCardId: cardId,
    claimType,
    title: claimType,
    issuerType: 'self',
    trustLevel: 'L1',
    source: 'test',
    payload: '{}',
    isPresentable: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function credential(id: string, rawJwt: string, metadataTags: readonly string[]): StoredCredential {
  return {
    id,
    type: 'test',
    title: 'Test',
    issuerDid: HOLDER_DID,
    holderDid: HOLDER_DID,
    trustLevel: 'L1',
    rawJwt,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    metadataTags,
  };
}

function deps(
  claims: readonly ProvableClaimEntity[],
  creds: ReadonlyMap<string, StoredCredential>,
): PresentationBuilderDeps {
  return {
    publicJwk: async () => HOLDER_JWK,
    signJwt: async (header, payload) => signJwtEs256(header, payload, HOLDER_PRIV),
    getProvableClaims: () => claims,
    getCredentials: () => creds,
  };
}

const request = buildSyntheticPresentRequest(['name', 'email'], AUD, 'nonce-1');

describe('buildVpToken — selective disclosure honesty', () => {
  it('FAILS CLOSED when only a subset of an ordinary JWT credential is selected', async () => {
    const claims = [provable('c-name', 'card', 'name'), provable('c-email', 'card', 'email')];
    const creds = new Map([['card', credential('card', plainVc(), ['jwt_vc_json'])]]);

    const built = await buildVpToken({
      request,
      selectedClaimIds: ['c-name'], // subset of {name, email}
      holderDid: HOLDER_DID,
      deps: deps(claims, creds),
    });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toMatch(/leak|selective disclosure/iu);
  });

  it('embeds an ordinary JWT credential verbatim only when ALL its claims are selected', async () => {
    const claims = [provable('c-name', 'card', 'name'), provable('c-email', 'card', 'email')];
    const raw = plainVc();
    const creds = new Map([['card', credential('card', raw, ['jwt_vc_json'])]]);

    const built = await buildVpToken({
      request,
      selectedClaimIds: ['c-name', 'c-email'], // full disclosure
      holderDid: HOLDER_DID,
      deps: deps(claims, creds),
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { payload } = decodeJwtUnsafe<{ vp?: { verifiableCredential?: readonly string[] } }>(
      built.value.vpJwt,
    );
    expect(payload.vp?.verifiableCredential).toEqual([raw]);

    const verified = await verifyVpToken(built.value.vpJwt, { expectedAud: AUD });
    expect(verified.credentials).toHaveLength(1);
  });

  it('redacts a real SD-JWT to only the selected disclosures — the withheld one never reaches the wire', async () => {
    const { combined, byName } = sdVc({ age_over_18: true, nationality: 'JP' });
    const claims = [provable('c-age', 'sd', 'age_over_18'), provable('c-nat', 'sd', 'nationality')];
    const creds = new Map([['sd', credential('sd', combined, ['sd-jwt-fallback'])]]);

    const built = await buildVpToken({
      request: buildSyntheticPresentRequest(['age_over_18'], AUD, 'nonce-sd'),
      selectedClaimIds: ['c-age'], // subset → redact
      holderDid: HOLDER_DID,
      deps: deps(claims, creds),
    });

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { payload } = decodeJwtUnsafe<{ vp?: { verifiableCredential?: readonly string[] } }>(
      built.value.vpJwt,
    );
    const embedded = payload.vp?.verifiableCredential ?? [];
    expect(embedded).toHaveLength(1);
    const wire = embedded[0] as string;
    // Full raw SD-JWT (with nationality) is NOT what's embedded.
    expect(wire).not.toBe(combined);
    expect(wire.includes(byName['age_over_18'] as string)).toBe(true);
    expect(wire.includes(byName['nationality'] as string)).toBe(false);

    // And it still verifies, reconstructing only the disclosed claim.
    const verified = await verifyVpToken(built.value.vpJwt, { expectedAud: AUD });
    expect(verified.credentials[0]?.claims['age_over_18']).toBe(true);
    expect(verified.credentials[0]?.claims['nationality']).toBeUndefined();
  });

  it('refuses to present a credential that failed import verification', async () => {
    const claims = [provable('c-name', 'card', 'name')];
    const creds = new Map([['card', credential('card', plainVc(), ['jwt_vc_json', 'unverified'])]]);

    const built = await buildVpToken({
      request,
      selectedClaimIds: ['c-name'],
      holderDid: HOLDER_DID,
      deps: deps(claims, creds),
    });

    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.message).toMatch(/unverified/iu);
  });
});
