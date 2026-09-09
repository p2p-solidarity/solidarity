/**
 * `src/pear/presentBuilder.ts` — pure logic for A5.3's SD-JWT-over-Pear
 * presentation: which locally-held provable claims answer an incoming
 * `present.request`'s requested claim TYPES, and how to shape a synthetic
 * `ParsedOidcRequest` so the EXISTING OID4VP presenter (`oidc/presenter.ts`'s
 * `buildVpToken`) can build the VP without knowing it's running over a Pear
 * channel instead of an HTTP verifier flow — this IS the "SD-JWT 出示走既有
 * presenter" reuse the phase brief asks for; no VP-building/signing logic is
 * reimplemented here.
 *
 * No RN/keychain/network touched here — same reasoning as `cardRelease.ts`'s
 * module doc for why the consent-handler composition (`presentRelease.ts`)
 * stays pure and dependency-injected.
 */
import type { OIDCAuthRequest } from '@solidarity/shared';

import { resolvedProofTypeTag } from '@/credentials/presentationProof';
import { classifyCredentialFormat } from '@/credentials/selectiveDisclosure';
import type { StoredCredential } from '@/credentials/store';
import type { ProvableClaimEntity } from '@/identity/entities';
import type { ParsedOidcRequest } from '@/oidc/parseAuthRequest';

/** What the present-consent sheet shows per matched claim — enough to let
 *  the user pick which ones to disclose, nothing more. */
export interface PresentableClaim {
  readonly id: string;
  readonly claimType: string;
  readonly title: string;
}

/**
 * Which locally-held, presentable claims answer `requestedClaimTypes`.
 * Three honesty gates, each documented because skipping any one would
 * either over-disclose or offer a presentation this app can't actually
 * build (CLAUDE.md rule 8 — no fake data, never dress up "I can't show you
 * this" as something that was shown):
 *   1. `claim.isPresentable` — never offer a claim the identity layer
 *      itself marked non-presentable.
 *   2. `claim.claimType` must be one of the requested types — never
 *      over-disclose a claim nobody asked for.
 *   3. The claim's backing credential must exist, must not be declared
 *      ZK-backed by its proof-type tag, AND must be JWT-shaped.
 *      `oidc/presenter.ts`'s `buildVpToken` wraps a credential's raw JWT
 *      string verbatim into a VP, so a ZK-proof-backed credential (a
 *      passport enrolled via the openac-v3 pipeline, say) would silently
 *      produce a VP the requester's `verifyVpToken` can only fail to parse.
 *      This asks `classifyCredentialFormat` — the SAME authority
 *      `resolveEmbeddedCredential` fails closed on downstream — rather than
 *      a proof-type tag. A tag could not answer it: `resolvedProofTypeTag`
 *      only knows `mopro-noir`/`semaphore-zk` and returns
 *      `'sd-jwt-fallback'` for everything else, including an openac-v3
 *      passport (tagged `passport-openac-v3`/`passport-noir`), so the gate
 *      let exactly the credential it names straight through and the consent
 *      sheet offered an option that always failed. Agreeing with the
 *      downstream gate by construction keeps them from drifting again the
 *      next time a proof type is added — see A5.3's report for what IS
 *      presentable today given passport stays ZK-only until A10.
 */
export function matchPresentableClaims(
  requestedClaimTypes: readonly string[],
  provableClaims: readonly ProvableClaimEntity[],
  credentialById: ReadonlyMap<string, StoredCredential>
): readonly PresentableClaim[] {
  const requested = new Set(requestedClaimTypes);
  const out: PresentableClaim[] = [];
  for (const claim of provableClaims) {
    if (!claim.isPresentable) continue;
    if (!requested.has(claim.claimType)) continue;
    const credential = credentialById.get(claim.identityCardId);
    if (!credential) continue;
    // Two checks, because neither alone is sufficient. The proof-type tag
    // keeps a credential the enrollment pipeline declared ZK-backed out
    // whatever its payload happens to look like; the format authority catches
    // what the tag cannot see, since `resolvedProofTypeTag` only knows
    // `mopro-noir`/`semaphore-zk` and answers `'sd-jwt-fallback'` for an
    // openac-v3 passport too.
    if (resolvedProofTypeTag(credential.metadataTags) !== 'sd-jwt-fallback') continue;
    const format = classifyCredentialFormat(credential.rawJwt);
    if (format !== 'jwt-vc' && format !== 'sd-jwt') continue;
    out.push({ id: claim.id, claimType: claim.claimType, title: claim.title });
  }
  return out;
}

/**
 * Build the `ParsedOidcRequest` shape `buildVpToken` expects, without an
 * actual OIDC HTTP request ever existing — the reuse seam the phase brief
 * asks for. `client_id` becomes the VP's `aud` claim: the REQUESTER's own
 * root did, as authenticated by the Pear handshake
 * (`AuthenticatedChannel.peerDid`, read from the RESPONDER's side) — so the
 * requester's own `verifyVpToken({expectedAud: myRootDid})` call can bind
 * acceptance to "this VP was minted for me specifically", not just "this VP
 * is validly signed by someone". `nonce` is a fresh random value per
 * request — there is no wire round-trip in `protocol.ts`'s
 * `present.request`/`present.response` to carry a requester-chosen nonce
 * back for comparison, so (same as the existing QR-scan verify path in
 * `app/scan/index.tsx`) freshness here rests on the SINGLE already-
 * authenticated, ephemeral Pear connection this exchange happens over,
 * not on `proofVerifier.ts` checking the nonce against an expected value
 * (it doesn't — see A5.3's report for that pre-existing limitation).
 */
export function buildSyntheticPresentRequest(
  requestedClaimTypes: readonly string[],
  audienceDid: string,
  nonce: string
): ParsedOidcRequest {
  const request: OIDCAuthRequest = {
    client_id: audienceDid,
    nonce,
    scope: [],
    response_type: 'vp_token id_token',
    response_mode: 'direct_post',
    presentation_definition: {
      id: 'pear-present',
      input_descriptors: requestedClaimTypes.map((claimType) => ({ id: claimType })),
    },
  };
  return { request, source: 'pear' };
}
