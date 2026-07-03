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
 *
 * Fix round 1 (post-review) also adds a DIRECT test of
 * `usePresentRequestFlow.ts::buildPearPresentation` — the effectful glue
 * this file's other tests only exercised indirectly via hand-shaped calls
 * to its constituent pieces. `buildPearPresentation` used to pass
 * `selectedClaimIds` (`PresentableClaim.id`s, e.g. `'claim-age-over-18'`)
 * straight through as `buildSyntheticPresentRequest`'s `requestedClaimTypes`
 * param (which needs claim TYPES, e.g. `'age_over_18'`) — silently
 * mislabelling every `presentation_definition.input_descriptors[].id`.
 * Inert only because `buildPearPresentation` discards
 * `result.value.presentationSubmission` and no wire consumer inspects it
 * today. Loading `usePresentRequestFlow.ts` additionally pulls in
 * `lane.ts` (`react-native-bare-kit` + the worklet bundle) and
 * `lifecycle.ts` (`react-native`'s `AppState`) even though this suite never
 * calls the `usePresentRequestFlow` hook itself (only the plain async
 * `buildPearPresentation` export) — those three get the same inert-stub
 * treatment `pearLaneManager.test.ts` already established. Observing the
 * fixed/broken `input_descriptors` requires capturing the `ParsedOidcRequest`
 * `buildPearPresentation` builds internally (it's never returned to the
 * caller), so `presentBuilder.ts` is also mocked here — but ONLY to wrap
 * `buildSyntheticPresentRequest` with a capturing spy that delegates to the
 * REAL implementation (already bound via the static import above, before
 * any mock.module call runs); `matchPresentableClaims` is re-exported
 * verbatim so this mock doesn't drop it for any other file sharing the
 * process-wide module cache — the exact class of bug fixed below for
 * `@/keychain/signingKey`.
 */
import { describe, expect, it, mock } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  decodeJwtUnsafe,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  signJwtEs256,
  type Signer,
  type PublicKeyJWK,
} from '@solidarity/shared';

import type { StoredCredential } from '../../src/credentials/store';
import type { ParsedOidcRequest } from '../../src/oidc/parseAuthRequest';
import { verifyVpToken } from '../../src/oidc/proofVerifier';
import { buildSyntheticPresentRequest, matchPresentableClaims } from '../../src/pear/presentBuilder';

const HOLDER_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 3 + 1) & 0xff);
const HOLDER_PUB = publicKeyFromPrivate(HOLDER_PRIV);
const HOLDER_DID = didKeyFromPublicKey(HOLDER_PUB);
const HOLDER_JWK: PublicKeyJWK = publicKeyToJwk(HOLDER_PUB);

const REQUESTER_DID = 'did:key:zRequesterRootDid';
const RESPONDER_ROOT_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 11 + 7) & 0xff);
const RESPONDER_ROOT_PUB = publicKeyFromPrivate(RESPONDER_ROOT_PRIV);
const RESPONDER_ROOT_DID = didKeyFromPublicKey(RESPONDER_ROOT_PUB);
const OTHER_ROOT_DID = 'did:key:zOtherAuthenticatedPeerRoot';
const responderRootSigner: Signer = async (digest) =>
  p256.sign(digest, RESPONDER_ROOT_PRIV, { prehash: false });

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

async function expectRejectsWith(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    expect(e instanceof Error ? e.message : String(e)).toMatch(pattern);
    return;
  }
  throw new Error('expected promise to reject');
}

const PROVABLE_CLAIMS = [
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
] as const;

const CREDENTIALS = new Map<string, StoredCredential>([
  [CRED_AGE_ID, storedCredential(CRED_AGE_ID, VC_AGE_JWT)],
  [CRED_NATIONALITY_ID, storedCredential(CRED_NATIONALITY_ID, VC_NATIONALITY_JWT)],
]);

const PRESENTATION_DEPS = {
  publicJwk: async () => HOLDER_JWK,
  signJwt: async (
    header: { alg: 'ES256'; typ?: string; kid?: string },
    payload: Record<string, unknown>
  ) => signJwtEs256(header, payload, HOLDER_PRIV),
  getProvableClaims: () => PROVABLE_CLAIMS,
  getCredentials: () => CREDENTIALS,
};

const PEAR_PRESENTATION_DEPS = {
  getRootDid: async () => ({ ok: true as const, value: RESPONDER_ROOT_DID }),
  getRootSigner: async () => ({ ok: true as const, value: responderRootSigner }),
  getProvableClaims: () => PROVABLE_CLAIMS,
  presentationDeps: PRESENTATION_DEPS,
};

// Mocks must be registered BEFORE the module under test is imported — see
// `identitySelectors.test.ts`/`spruceDid.parity.test.ts`'s top-level-await
// pattern, which this mirrors (rather than a `beforeAll` + explicit
// `typeof import(...)` type annotation for a deferred binding).
//
// `usePresentRequestFlow.ts` (the module `buildPearPresentation` lives in,
// exercised below) transitively imports `lane.ts` (`react-native-bare-kit`
// + the worklet bundle) and `lifecycle.ts` (`react-native`'s `AppState`)
// via `laneManager.ts` — none of which this suite calls (only the plain
// async `buildPearPresentation` export, never the `usePresentRequestFlow`
// hook). Inert stubs, same recipe as `pearLaneManager.test.ts`.
await mock.module('react-native-bare-kit', () => ({
  Worklet: function FakeWorklet(): void {
    // Never actually constructed — this suite only calls the plain async
    // `buildPearPresentation` export, never `usePresentRequestFlow`'s
    // `start()` (the only path that reaches `lane.ts`'s real `new
    // Worklet(...)`). Throws loudly rather than silently no-op-ing if that
    // ever changes.
    throw new Error('test: Worklet unavailable in pearPresentRoundTrip suite');
  },
}));
await mock.module('../../pear/worklet/dist/index.bundle.js', () => ({ default: 'fake-bundle-source' }));

// A plain value copy of the real implementation, taken BEFORE the
// `mock.module` call below — `bun:test`'s mock.module rebinds the module's
// export object in place, which also repoints already-resolved static
// `import` bindings (confirmed empirically: closing over the imported name
// directly inside the mock factory recurses into the mock itself and blows
// the call stack). A local `const` captures the function value, not a live
// binding, so it stays pinned to the real implementation.
const realBuildSyntheticPresentRequest = buildSyntheticPresentRequest;

/** Captures the `ParsedOidcRequest` the module-under-test's internal
 *  `buildSyntheticPresentRequest` call actually built, so the fix-round-1
 *  tests below can inspect `presentation_definition.input_descriptors`
 *  directly — `buildPearPresentation` never returns that object to its
 *  caller (see this file's module doc). Reset/read go through functions
 *  (not direct variable/property access) deliberately — TS narrows a
 *  dotted name exactly like a bare `let`: a literal `x.current = undefined`
 *  reset earlier in the SAME test body pins later reads of `x.current` to
 *  `undefined` across the `await buildPearPresentation(...)` call that
 *  actually mutates it from a different closure, collapsing the type to
 *  `never`. A function call's declared return type isn't narrowed this
 *  way, so routing through `readCapturedPearRequest()` sidesteps it. */
let capturedPearRequestValue: ParsedOidcRequest | undefined;
function resetCapturedPearRequest(): void {
  capturedPearRequestValue = undefined;
}
function readCapturedPearRequest(): ParsedOidcRequest | undefined {
  return capturedPearRequestValue;
}
await mock.module('../../src/pear/presentBuilder', () => ({
  // Re-exported verbatim (not omitted) so this mock doesn't shadow
  // `matchPresentableClaims` for any other file sharing bun's process-wide
  // module cache — the same completeness fix applied to the
  // `@/keychain/signingKey` mock above, applied here preemptively.
  matchPresentableClaims,
  buildSyntheticPresentRequest: (
    requestedClaimTypes: readonly string[],
    audienceDid: string,
    nonce: string
  ): ParsedOidcRequest => {
    // Delegates to the REAL implementation captured above — a capturing
    // spy, not a behavioural fake.
    capturedPearRequestValue = realBuildSyntheticPresentRequest(
      requestedClaimTypes,
      audienceDid,
      nonce
    );
    return capturedPearRequestValue;
  },
}));

// Pull the module under test AFTER the mocks are installed — TS infers
// `buildVpToken`'s type from the destructure, no `typeof import(...)`
// annotation needed.
const { buildVpToken } = await import('../../src/oidc/presenter');
const { buildPearPresentation } = await import('../../src/pear/usePresentRequestFlow');

describe('A5.3 round trip: presentBuilder -> real buildVpToken -> real verifyVpToken', () => {
  it('builds against the synthetic Pear request and verifies with expectedAud bound to the requester', async () => {
    const request = buildSyntheticPresentRequest(['age_over_18'], REQUESTER_DID, 'test-nonce');

    const built = await buildVpToken({
      request,
      selectedClaimIds: ['claim-age-over-18'],
      holderDid: HOLDER_DID,
      deps: PRESENTATION_DEPS,
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
      deps: PRESENTATION_DEPS,
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
      deps: PRESENTATION_DEPS,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expectRejectsWith(
      verifyVpToken(built.value.vpJwt, { expectedAud: 'did:key:zSomeOtherRequester' }),
      /aud mismatch/u
    );
  });
});

describe('A5.3 fix round 1: buildPearPresentation threads claim TYPES, not PresentableClaim ids', () => {
  it("builds input_descriptors keyed by the selected claim's TYPE, not its PresentableClaim id", async () => {
    resetCapturedPearRequest();

    const built = await buildPearPresentation(
      ['claim-age-over-18'],
      REQUESTER_DID,
      PEAR_PRESENTATION_DEPS
    );
    expect(built.ok).toBe(true);

    // This is the object `buildVpToken` actually received — proof the
    // threading fix reaches `presentation_definition`, not just an
    // assertion against `buildSyntheticPresentRequest` called by hand.
    const request = readCapturedPearRequest();
    if (!request) throw new Error('expected buildSyntheticPresentRequest to have been called');
    const descriptorIds = (request.request.presentation_definition?.input_descriptors ?? []).map(
      (d) => d.id
    );
    expect(descriptorIds).toEqual(['age_over_18']);
    // The exact bug this guards: the `PresentableClaim.id` leaking through
    // as a "claim type" instead of the real one.
    expect(descriptorIds).not.toContain('claim-age-over-18');
  });

  it('two selected claims of different types produce one descriptor per distinct TYPE', async () => {
    resetCapturedPearRequest();

    const built = await buildPearPresentation(
      ['claim-age-over-18', 'claim-nationality'],
      REQUESTER_DID,
      PEAR_PRESENTATION_DEPS
    );
    expect(built.ok).toBe(true);

    const request = readCapturedPearRequest();
    if (!request) throw new Error('expected buildSyntheticPresentRequest to have been called');
    const descriptorIds = (request.request.presentation_definition?.input_descriptors ?? []).map(
      (d) => d.id
    );
    expect(new Set(descriptorIds)).toEqual(new Set(['age_over_18', 'nationality']));
    expect(descriptorIds).not.toContain('claim-age-over-18');
    expect(descriptorIds).not.toContain('claim-nationality');
  });

  it('round-trips through the real verifyVpToken for exactly the selected claim', async () => {
    const built = await buildPearPresentation(
      ['claim-age-over-18'],
      REQUESTER_DID,
      PEAR_PRESENTATION_DEPS
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const verified = await verifyVpToken(built.sdJwt, {
      expectedAud: REQUESTER_DID,
      expectedRootDid: RESPONDER_ROOT_DID,
    });
    expect(verified.holderDid).toBe(HOLDER_DID);
    expect(verified.credentials).toHaveLength(1);
    expect(verified.credentials[0]?.claims['vc']).toEqual({
      credentialSubject: { id: HOLDER_DID, claim: 'age_over_18' },
    });
  });

  it('rejects a Pear presentation when the authenticated peer root DID is not the root bound to the card key', async () => {
    const built = await buildPearPresentation(
      ['claim-age-over-18'],
      REQUESTER_DID,
      PEAR_PRESENTATION_DEPS
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expectRejectsWith(
      verifyVpToken(built.sdJwt, {
        expectedAud: REQUESTER_DID,
        expectedRootDid: OTHER_ROOT_DID,
      }),
      /root DID/u
    );
  });
});
