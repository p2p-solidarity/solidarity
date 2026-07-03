/**
 * Domain verification — TS port of
 * solidarity/Services/Utils/DomainVerificationManager.swift.
 *
 * The Swift manager has a much wider surface (cryptographic email/domain
 * commitments, DNS lookups, anonymous group membership proofs), but the
 * only piece the deep-link parser actually needs is "is this host one we
 * trust to handle solidarity:// payloads over https://".
 *
 * We mirror the Swift `isTrustedDomain` allowlist verbatim — plus the
 * Solidarity-owned hosts the Swift app routes through `AppBranding`.
 * Future DNS-backed verification belongs here as well; for now the
 * allowlist is the single source of truth.
 */

const TRUSTED_HOSTS: ReadonlySet<string> = new Set<string>([
  // Solidarity / AirMeishi product hosts (mirrors AppBranding).
  'solidarity.gg',
  'airmeishi.app',
  // Swift `DomainVerificationManager.isTrustedDomain` allowlist.
  'apple.com',
  'google.com',
  'microsoft.com',
  'github.com',
  'linkedin.com',
]);

function matchesWildcard(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/**
 * Returns true when `host` (e.g. `share.solidarity.gg`) is rooted at one
 * of the trusted hosts. Subdomains are accepted under the same root.
 * Comparison is case-insensitive, matching the Swift implementation.
 */
export function isVerifiedDomain(host: string): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  for (const root of TRUSTED_HOSTS) {
    if (matchesWildcard(lower, root)) return true;
  }
  return false;
}

/**
 * Solidarity/AirMeishi-owned hosts — a strict SUBSET of `TRUSTED_HOSTS`
 * above. `TRUSTED_HOSTS`/`isVerifiedDomain` also allowlists third-party
 * identity providers (apple.com, google.com, microsoft.com, github.com,
 * linkedin.com) trusted for a DIFFERENT purpose (OIDC/domain
 * verification) — those hosts must NOT be able to trigger an in-app
 * routing side effect (Pear connect, card connect) just because a path
 * happens to match `/pear/<did>` or `/c/<uuid>`. `parseVerifiedDomainRoute`
 * (`./parser.ts`) gates those two routes on `isProductHost`, not
 * `isVerifiedDomain`. See Task A5.4 code-review Finding 1.
 */
const PRODUCT_HOSTS: ReadonlySet<string> = new Set<string>(['solidarity.gg', 'airmeishi.app']);

/**
 * Returns true when `host` is rooted at a Solidarity/AirMeishi-owned host
 * (subdomains accepted, same matching semantics as `isVerifiedDomain`).
 */
export function isProductHost(host: string): boolean {
  if (!host) return false;
  const lower = host.toLowerCase();
  for (const root of PRODUCT_HOSTS) {
    if (matchesWildcard(lower, root)) return true;
  }
  return false;
}
