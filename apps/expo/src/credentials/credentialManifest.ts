/**
 * Credential manifest — minimal non-sensitive fields the VC list needs on
 * frame 1. Stored plaintext (MMKV-encrypted, not per-blob AES) so cold
 * launch can render titles + trust badges without decrypting each JWT.
 *
 * Full StoredCredential (rawJwt, issuerDid, holderDid, issuedAt, expiresAt,
 * metadataTags, claim contents) stays in the encrypted `vc:{id}` keys and
 * is decrypted lazily on detail open or via `hydrate()` in the background.
 *
 * Safe to include:
 *   - id          — opaque UUID (stable record key)
 *   - title       — display label already shown on lists/hero
 *   - trustLevel  — L1/L2/L3/L3+ enum → drives the green/blue/grey row chip
 *   - type        — coarse enum the list uses to pick an SF Symbol
 *                   (passport / student / social_graph / …)
 *
 * Excluded (kept encrypted): rawJwt, issuerDid, holderDid, issuedAt,
 * expiresAt, metadataTags, and any claim payload contents.
 *
 * Privacy note on `type`: this field can leak capability (e.g. the holder
 * owns a `passport` credential) and is technically sensitive. It is kept
 * in the manifest for now because the Me-tab + VC-management list both
 * render it as the row icon and we want frame-1 paint without decrypt.
 * Revisit if the threat model upgrades to "no capability hints in the
 * sidecar" — the list can fall back to a generic shield icon until
 * `details` hydrates.
 */
import type { StoredCredential, TrustLevel } from './store';

export interface CredentialManifestEntry {
  readonly id: string;
  readonly title: string;
  readonly trustLevel: TrustLevel;
  readonly type: string;
}

export function toCredentialManifest(c: StoredCredential): CredentialManifestEntry {
  return {
    id: c.id,
    title: c.title,
    trustLevel: c.trustLevel,
    type: c.type,
  };
}

export const CREDENTIALS_MANIFEST_SCOPE = 'credentials:v1';
