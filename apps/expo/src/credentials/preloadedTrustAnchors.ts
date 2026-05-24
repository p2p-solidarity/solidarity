/**
 * Preloaded trust anchors — issuers the wallet ships pre-trusted at install.
 *
 * Mirrors the Swift contract: `solidarity/Services/Identity/
 * IssuerTrustAnchorStore.swift` ships with an EMPTY hardcoded list. The
 * Swift store only adds anchors through `registerAnchorWithConsent(...)`
 * after the user passes a biometric prompt — there is no compile-time
 * allowlist.
 *
 * Keeping this list empty here preserves the same security posture: trust
 * is earned at runtime, never inherited from a binary. If/when product
 * decides to ship a sovereign-government root or a partner ecosystem root
 * out of the box, mirror exactly what Swift adds at the same time.
 */
import type { PublicKeyJWK } from '@solidarity/shared';

export interface PreloadedTrustAnchor {
  readonly issuerDid: string;
  readonly publicKeyJwk: PublicKeyJWK;
  readonly keyId?: string;
  readonly displayName: string;
}

/**
 * Issuers trusted at app install. Currently empty — see file header.
 * Adding here MUST be accompanied by the same entries in Swift's
 * `IssuerTrustAnchorStore` so cross-platform behaviour stays aligned.
 */
export const PRELOADED_TRUST_ANCHORS: readonly PreloadedTrustAnchor[] = [];
