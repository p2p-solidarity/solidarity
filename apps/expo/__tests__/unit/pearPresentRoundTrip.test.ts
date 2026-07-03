/**
 * A5.3 round-trip: `pear/presentBuilder.ts`'s synthetic request feeds the
 * REAL, existing `oidc/presenter.ts::buildVpToken` (no reimplementation),
 * and the result is checked with the REAL `oidc/proofVerifier.ts::verifyVpToken`
 * — the exact reuse seam the phase brief asks for ("SD-JWT 出示走既有
 * presenter，通道內驗證(復用 oidc/proofVerifier)"). `buildVpToken` reaches
 * into `@/keychain/signingKey` (native SpruceID module) and `@/identity` /
 * `@/credentials/store` (MMKV-backed zustand stores), none of which load
 * under plain `bun test` — so, mirroring `identitySelectors.test.ts`'s
 * `mock.module` pattern, this suite stubs exactly those three surfaces and
 * imports `buildVpToken` dynamically AFTER the mocks are registered.
 * `proofVerifier.ts` has no such dependencies and is imported normally.
 *
 * What this proves end to end:
 *   1. `buildSyntheticPresentRequest`'s shape is genuinely accepted by the
 *      real `buildVpToken` (not just type-compatible on paper).
 *   2. Selective disclosure holds through the REAL claim-id -> credential
 *      resolution path (`rawCredentialIdsFor` in presenter.ts): presenting
 *      claim X's credential never leaks claim Y's credential.
 *   3. The produced VP round-trips through the REAL `verifyVpToken`,
 *      including the `expectedAud` binding this task's design relies on.
 */
import { describe, expect, it, mock } from 'bun:test';

import {
  decodeJwtUnsafe,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  signJwtEs256,
  type PublicKeyJWK,
} from '@solidarity/shared';

import type { StoredCredential } from '../../src/credentials/store';
import { verifyVpToken } from '../../src/oidc/proofVerifier';
import { buildSyntheticPresentRequest } from '../../src/pear/presentBuilder';

const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 3 + 1) & 0xff);
const HOLDER_PUB = publicKeyFromPrivate(HOLDER_PRIV);
const HOLDER_DID = didKeyFromPublicKey(HOLDER_PUB);
const HOLDER_JWK: PublicKeyJWK = publicKeyToJwk(HOLDER_PUB);

const REQUESTER_DID = 'did:key:zRequesterRootDid';

function signVc(claimTag: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwtEs256(
    { alg: 'ES256', kid: `${HOLDER_DID}#0` },
    {
      iss: HOLDER_DID,
      sub: HOLDER_DID,
      iat: now,
      exp: now + 3600,
      vc: { credentialSubject: { id: HOLDER_DID, claim: claimTag } },
    },
    HOLDER_PRIV
  );
}

const CRED_AGE_ID = 'cred-age-over-18';
const CRED_NATIONALITY_ID = 'cred-nationality';
const VC_AGE_JWT = signVc('age_over_18');
const VC_NATIONALITY_JWT = signVc('nationality');

function storedCredential(id: string, rawJwt: string): StoredCredential {
  return {
    id,
    type: 'test',
    title: 'Test credential',
    issuerDid: HOLDER_DID,
    holderDid: HOLDER_DID,
    trustLevel: 'L1',
    rawJwt,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    metadataTags: ['sd-jwt-fallback'],
  };
}

// Mocks must be registered BEFORE the module under test is imported — see
// `identitySelectors.test.ts`/`spruceDid.parity.test.ts`'s top-level-await
// pattern, which this mirrors (rather than a `beforeAll` + explicit
// `typeof import(...)` type annotation for a deferred binding).
await mock.module('@/keychain/signingKey', () => ({
  publicJwk: async () => HOLDER_JWK,
  signJwt: async (
    header: { alg: 'ES256'; typ?: string; kid?: string },
    payload: Record<string, unknown>
  ) => signJwtEs256(header, payload, HOLDER_PRIV),
}));
await mock.module('@/identity', () => ({
  useIdentityData: {
    getState: () => ({
      provableClaims: [
        {
          id: 'claim-age-over-18',
          identityCardId: CRED_AGE_ID,
          claimType: 'age_over_18',
          title: 'I am over 18',
          issuerType: 'self',
          trustLevel: 'L1',
          source: 'test',
          payload: '{}',
          isPresentable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'claim-nationality',
          identityCardId: CRED_NATIONALITY_ID,
          claimType: 'nationality',
          title: 'Nationality verified',
          issuerType: 'self',
          trustLevel: 'L1',
          source: 'test',
          payload: '{}',
          isPresentable: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    }),
  },
}));
await mock.module('@/credentials/store', () => ({
  useCredentialStore: {
    getState: () => ({
      details: new Map<string, StoredCredential>([
        [CRED_AGE_ID, storedCredential(CRED_AGE_ID, VC_AGE_JWT)],
        [CRED_NATIONALITY_ID, storedCredential(CRED_NATIONALITY_ID, VC_NATIONALITY_JWT)],
      ]),
    }),
  },
}));

// Pull the module under test AFTER the mocks are installed — TS infers
// `buildVpToken`'s type from the destructure, no `typeof import(...)`
// annotation needed.
const { buildVpToken } = await import('../../src/oidc/presenter');

describe('A5.3 round trip: presentBuilder -> real buildVpToken -> real verifyVpToken', () => {
  it('builds against the synthetic Pear request and verifies with expectedAud bound to the requester', async () => {
    const request = buildSyntheticPresentRequest(['age_over_18'], REQUESTER_DID, 'test-nonce');

    const built = await buildVpToken({
      request,
      selectedClaimIds: ['claim-age-over-18'],
      holderDid: HOLDER_DID,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const verified = await verifyVpToken(built.value.vpJwt, { expectedAud: REQUESTER_DID });
    expect(verified.holderDid).toBe(HOLDER_DID);
    expect(verified.credentials).toHaveLength(1);
  });

  it('selective disclosure: presenting claim X never includes claim Y\'s credential', async () => {
    const request = buildSyntheticPresentRequest(['age_over_18'], REQUESTER_DID, 'test-nonce-2');
    const built = await buildVpToken({
      request,
      selectedClaimIds: ['claim-age-over-18'],
      holderDid: HOLDER_DID,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    // Decode the actual embedded-credential list — base64url-encoding the
    // outer VP payload means the inner VC JWT is NOT a raw substring of the
    // encoded VP JWT, so this must inspect the decoded structure rather
    // than string-search the wire bytes.
    const { payload } = decodeJwtUnsafe<{ vp?: { verifiableCredential?: readonly string[] } }>(
      built.value.vpJwt
    );
    const embedded = payload.vp?.verifiableCredential ?? [];
    // X present.
    expect(embedded).toContain(VC_AGE_JWT);
    // Y absent — not merely "not selected", genuinely never embedded.
    expect(embedded).not.toContain(VC_NATIONALITY_JWT);
    expect(embedded).toHaveLength(1);

    const verified = await verifyVpToken(built.value.vpJwt, { expectedAud: REQUESTER_DID });
    expect(verified.credentials).toHaveLength(1);
    expect(verified.credentials[0]?.claims['vc']).toEqual({
      credentialSubject: { id: HOLDER_DID, claim: 'age_over_18' },
    });
  });

  it('a VP minted for a different audience is rejected by the real verifier', async () => {
    const request = buildSyntheticPresentRequest(['age_over_18'], REQUESTER_DID, 'test-nonce-3');
    const built = await buildVpToken({
      request,
      selectedClaimIds: ['claim-age-over-18'],
      holderDid: HOLDER_DID,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      verifyVpToken(built.value.vpJwt, { expectedAud: 'did:key:zSomeOtherRequester' })
    ).rejects.toThrow(/aud mismatch/u);
  });
});
