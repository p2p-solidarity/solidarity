/**
 * Issuer manifest — minimal non-sensitive fields the issuer-badge list
 * needs on frame 1. Stored plaintext (MMKV-encrypted, not per-blob AES)
 * so cold launch can render issuer names without decrypting each entry.
 *
 * Full `IssuerMetadata` (description, logoBase64 bytes, logoMimeType,
 * trustAnchor, lastRefreshedAt) stays in the encrypted `gg.solidarity.
 * credentials.issuers.v1` blob and is decrypted lazily via `hydrate()`.
 *
 * Safe to include:
 *   - did         — the opaque issuer key (DID or canonical URL). This is
 *                   the same value used as the storage map key; it carries
 *                   no PII for the *holder* (it identifies the *issuer*).
 *   - displayName — derived from the issuer's own `.well-known` display
 *                   block; already public.
 *
 * Excluded — privacy reasoning:
 *   - logoUri      — even though the URI is public, fetching it later can
 *                    leak "this wallet holds a VC from issuer X" to a CDN
 *                    or analytics pixel hosted at that URI. We do NOT
 *                    expose it through the manifest: the only place that
 *                    needs the bytes (IssuerBadge) reads `logoBase64` from
 *                    the encrypted record after `hydrate()`. That keeps a
 *                    tracking-pixel-style URI from being walked on every
 *                    cold launch by anything that scans the manifest.
 *   - logoBase64,  — bulk payload, not list-render data.
 *     logoMimeType
 *   - description, — list view doesn't use it.
 *     trustAnchor
 *   - lastRefreshedAt — internal cache bookkeeping.
 */
import type { IssuerMetadata } from './issuerStore';

export interface IssuerManifestEntry {
  /** Issuer DID or canonical URL — opaque, serves as the entry id. */
  readonly did: string;
  readonly displayName?: string;
}

export function toIssuerManifest(i: IssuerMetadata): IssuerManifestEntry {
  return {
    did: i.id,
    ...(i.displayName ? { displayName: i.displayName } : {}),
  };
}

export const ISSUERS_MANIFEST_SCOPE = 'issuers:v1';
