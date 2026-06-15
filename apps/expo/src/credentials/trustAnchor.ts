/**
 * TrustAnchor (credentials) — mirrors Swift
 * `solidarity/Services/Identity/IssuerTrustAnchorStore.swift`'s
 * `TrustedIssuerAnchor` struct, layered on top of the runtime store at
 * `src/identity/issuerTrustAnchor.ts`.
 *
 * Why this exists alongside the identity store:
 *   - The identity layer holds anchors the user has earned at runtime via
 *     biometric consent (matches Swift `registerAnchorWithConsent`).
 *   - This file adds the COMPILE-TIME `PRELOADED_TRUST_ANCHORS` list
 *     (currently empty — see `preloadedTrustAnchors.ts`) and exposes a
 *     single `trustsIssuer(did)` helper that the OID4VCI / VP layers can
 *     call without caring which source the trust came from.
 *
 * Trust precedence (highest → lowest):
 *   1. `manual`     — explicit user consent (identity store, source: 'manual')
 *   2. `wellknown`  — auto-trusted via /.well-known/openid-credential-issuer
 *                     metadata after user-initiated VCI flow
 *   3. `preloaded`  — shipped with the binary (see preloadedTrustAnchors.ts)
 *
 * Per Swift parity:
 *   - DIDs are normalised via lowercase + whitespace-strip before compare
 *   - keyId is optional; when omitted the first matching DID wins
 *   - `suffix` matching: a keyId like `did:web:foo#1` matches a stored
 *     entry whose keyId is `…#1` (last `#`-segment compare)
 */
import type { PublicKeyJWK } from '@solidarity/shared';

import {
  PRELOADED_TRUST_ANCHORS,
  type PreloadedTrustAnchor,
} from './preloadedTrustAnchors';
import {
  useIssuerTrustAnchorStore,
  type TrustAnchor as IdentityTrustAnchor,
} from '@/identity/issuerTrustAnchor';

export type TrustAnchorSource = 'manual' | 'wellknown' | 'preloaded';

export interface TrustAnchor {
  readonly issuerDid: string;
  readonly publicKeyJwk?: PublicKeyJWK;
  readonly keyId?: string;
  readonly verifiedAt: Date;
  readonly source: TrustAnchorSource;
}

function normalizeDid(did: string): string {
  return did.trim().toLowerCase();
}

function fromPreloaded(p: PreloadedTrustAnchor): TrustAnchor {
  return {
    issuerDid: p.issuerDid,
    publicKeyJwk: p.publicKeyJwk,
    ...(p.keyId ? { keyId: p.keyId } : {}),
    verifiedAt: new Date(0),
    source: 'preloaded',
  };
}

function fromIdentity(a: IdentityTrustAnchor): TrustAnchor {
  const source: TrustAnchorSource =
    a.source === 'manual' || a.source === 'group-invite' ? 'manual' : 'wellknown';
  return {
    issuerDid: a.did,
    ...(a.publicKeyJwk ? { publicKeyJwk: a.publicKeyJwk } : {}),
    ...(a.keyId ? { keyId: a.keyId } : {}),
    verifiedAt: a.addedAt,
    source,
  };
}

/**
 * Returns true when the issuer DID is recognised by any source. The check
 * is identical to Swift `isTrustedIssuer(_:keyId:)`.
 */
export function trustsIssuer(issuerDid: string, keyId?: string): boolean {
  return lookupAnchor(issuerDid, keyId) !== undefined;
}

/**
 * Resolve the highest-precedence anchor matching `issuerDid` (+ optional
 * keyId). Returns undefined when no source recognises the DID. The lookup
 * is sync because both layers keep state in memory after hydrate.
 */
export function lookupAnchor(
  issuerDid: string,
  keyId?: string
): TrustAnchor | undefined {
  const did = normalizeDid(issuerDid);

  const runtime = useIssuerTrustAnchorStore.getState().lookup(issuerDid, keyId);
  if (runtime) return fromIdentity(runtime);

  const preloaded = PRELOADED_TRUST_ANCHORS.filter(
    (p) => normalizeDid(p.issuerDid) === did
  );
  const first = preloaded[0];
  if (!first) return undefined;
  if (!keyId) return fromPreloaded(first);

  const exact = preloaded.find((p) => p.keyId === keyId);
  if (exact) return fromPreloaded(exact);

  const suffix = keyId.split('#').pop();
  if (!suffix) return fromPreloaded(first);
  const suffixMatch = preloaded.find(
    (p) => p.keyId?.split('#').pop() === suffix
  );
  return fromPreloaded(suffixMatch ?? first);
}

/** Returns the full set of trust anchors known across all sources. */
export function allTrustAnchors(): readonly TrustAnchor[] {
  const runtime = useIssuerTrustAnchorStore.getState().trusted.map(fromIdentity);
  const preloaded = PRELOADED_TRUST_ANCHORS.map(fromPreloaded);
  return [...runtime, ...preloaded];
}
