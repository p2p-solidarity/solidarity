/**
 * Deep-link parser — pure URL → route table, no React Native imports so
 * it tests cleanly under Bun without dragging the Flow-typed RN runtime.
 * The handler (with `router.push` side effects) lives in ./handler.
 */
import { DEFAULT_HANDLE_RESOLVERS, matchHandleResolver, resolveDidKey } from '@solidarity/shared';

import { WEBSIGN_DEEPLINK_HOST, WEBSIGN_REQUEST_PARAM } from '../websign/transport';
import { isProductHost, isVerifiedDomain } from './domainVerification';

export type DeepLinkRoute =
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'groupInvite'; readonly token: string }
  | { readonly kind: 'oidc'; readonly query: string }
  | { readonly kind: 'credentialOffer'; readonly query: string }
  | { readonly kind: 'verifiedProfile'; readonly fragment: string }
  | { readonly kind: 'verifiedPointer'; readonly npub: string }
  | { readonly kind: 'verifiedHandle'; readonly handle: string }
  | { readonly kind: 'pear'; readonly did: string }
  | { readonly kind: 'webSign'; readonly request: string }
  | { readonly kind: 'unknown'; readonly raw: string };

/** Cheap structural gate for the `#nostr:<npub>` short-pointer form — the
 *  real checksum/length validation is `userKey.ts`'s `npubDecode` in the
 *  resolver. This just filters obvious garbage and caps length on
 *  unauthenticated deep-link input (an npub is ~63 chars; 90 = headroom).
 *  Mirror of `verifiedPageHandler.ts`'s scanner-side gate. */
const NPUB_RE = /^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/u;
const MAX_NPUB_LENGTH = 90;

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

/**
 * A real did:key:z… (P-256) is ~58 chars (`did:key:z` + base58 of 35
 * bytes). 128 is generous headroom for future did:key variants while
 * still rejecting a pathologically long path segment (e.g. a 100 KB
 * string) before it ever reaches `resolveDidKey`'s base58 decode — cheap
 * DoS defense for a value that arrives as unauthenticated deep-link input.
 */
const MAX_PEAR_DID_LENGTH = 128;

/**
 * True iff `did` is a well-formed `did:key:z…` (P-256) — the ONLY validation
 * a `solidarity://pear/<did>` deep link's did gets before routing (Task
 * A5.4). `resolveDidKey` throws on anything malformed (bad prefix, bad
 * base58, wrong multicodec, invalid point); this never does, so a hostile or
 * garbled deep link path can't crash the parser — it just fails closed to
 * `unknown`. Exported so `PearConnectSection`'s screen-level guard
 * (`app/people/profile/[did].tsx`) can reuse the exact same check rather
 * than duplicating it.
 *
 * NOTE: this only proves the STRING is a structurally valid did:key — it is
 * NOT proof the deep-link sender actually controls that identity. That only
 * happens once the Pear handshake (`handshake.ts`'s `authenticateChannel`)
 * cryptographically authenticates the peer — see `PearConnectSection`'s
 * module doc for how the UI stays honest about that distinction.
 */
export function isValidPearDid(did: string): boolean {
  if (did.length > MAX_PEAR_DID_LENGTH) return false;
  try {
    resolveDidKey(did);
    return true;
  } catch {
    return false;
  }
}

function parseVerifiedHandleRoute(
  productHost: boolean,
  segments: readonly string[],
  hash: string
): DeepLinkRoute | null {
  const segment = segments[0];
  if (!productHost || hash.length > 0 || segments.length !== 1 || !segment?.startsWith('@')) {
    return null;
  }

  let handle: string;
  try {
    handle = decodeURIComponent(segment.slice(1));
  } catch {
    return null;
  }
  return matchHandleResolver(handle, DEFAULT_HANDLE_RESOLVERS) === undefined
    ? null
    : { kind: 'verifiedHandle', handle };
}

/**
 * The `https://<product-host>/websign#req=<X>` fragment form of the App↔Web
 * signing request (research §4). Split out to keep `parseVerifiedDomainRoute`
 * under the cyclomatic-complexity budget. `null` = no usable `req` → the
 * caller falls through to `unknown` (never to the Verified Page fragment
 * branch, which the `/websign` path already excluded).
 */
function parseWebSignDomainRoute(hash: string): DeepLinkRoute | null {
  if (hash.length <= 1) return null;
  const req = new URLSearchParams(hash.slice(1)).get(WEBSIGN_REQUEST_PARAM);
  return req !== null && req.length > 0 ? { kind: 'webSign', request: req } : null;
}

/**
 * `https://<verified-domain>/...` routes only — split out of `parseDeepLink`
 * to keep that function's cyclomatic complexity under budget as this branch
 * grows (card link, and now the Verified Page fragment link, 1.3.3 Task
 * A2.3 US-11). `null` means "recognised host, but no known route" — falls
 * through to `unknown` at the call site.
 */
function parseVerifiedDomainRoute(url: URL): DeepLinkRoute | null {
  const segments = url.pathname.replace(/^\//u, '').split('/');
  // `isVerifiedDomain` (the gate the caller already applied to reach this
  // function) also allowlists third-party identity hosts — apple.com,
  // google.com, microsoft.com, github.com, linkedin.com — trusted for a
  // DIFFERENT purpose (OIDC/domain verification). An in-app routing side
  // effect (card connect, Pear connect) must only fire on hosts WE own, so
  // the `card`/`pear` branches below additionally require `isProductHost`.
  // Code-review Finding 1, Task A5.4 follow-up.
  const productHost = isProductHost(url.host);
  if (productHost && segments[0] === 'c' && segments[1] && UUID_RE.test(segments[1])) {
    return { kind: 'card', cardId: segments[1] };
  }
  // Pear deep link universal-link equivalent (1.3.3 Task A5.4, US-20):
  // `https://solidarity.gg/pear/<did>` — same route as `solidarity://pear/
  // <did>` below, for the case a recipient opens the public web viewer's
  // "Request private view" link before the app scheme is registered.
  // `segments.length === 2` (no trailing/extra path parts) mirrors the
  // custom-scheme branch's strictness — reject path traversal / extra
  // segments rather than silently ignoring them.
  if (
    productHost &&
    segments[0] === 'pear' &&
    segments.length === 2 &&
    segments[1] &&
    isValidPearDid(segments[1])
  ) {
    return { kind: 'pear', did: segments[1] };
  }
  // `https://<product-host>/websign#req=<X>` (research §4) — the fragment form
  // of the App↔Web signing request, so `req` never leaves the device over the
  // network (01-spec §1/§8). Checked BEFORE the generic `#<fragment>` branch
  // below (which would otherwise swallow `#req=…` as a Verified Page blob) and
  // distinguished from it by the `/websign` path segment. Returns a sentinel
  // for "recognised /websign path" so a missing `req` fails to `unknown`
  // rather than falling through to the fragment branch.
  if (productHost && segments.length === 1 && segments[0] === WEBSIGN_DEEPLINK_HOST) {
    return parseWebSignDomainRoute(url.hash);
  }
  const handleRoute = parseVerifiedHandleRoute(productHost, segments, url.hash);
  if (handleRoute !== null) return handleRoute;
  // Verified Page link (1.3.3 Task A2.3, US-11): `https://solidarity.gg/#<fragment>`
  // — the fragment never leaves the device over the network (01-spec §1/§8),
  // so this is just recognising the shape and handing the raw fragment blob
  // to the same local-only verify pipeline the scanner uses
  // (`src/scan/verifiedPageHandler.ts`'s `verifyFragment`).
  if (url.hash.length > 1) {
    const hash = url.hash.slice(1);
    // Short-pointer form `#nostr:<npub>` — resolved asynchronously against
    // relays (`resolveProfile.ts`), unlike the self-contained offline blob.
    if (hash.startsWith('nostr:')) {
      const npub = hash.slice('nostr:'.length);
      // A `nostr:` prefix but a non-npub tail is NOT a fragment — fail to
      // `unknown` rather than mis-decoding `nostr:garbage` as a blob.
      return NPUB_RE.test(npub) && npub.length <= MAX_NPUB_LENGTH
        ? { kind: 'verifiedPointer', npub }
        : null;
    }
    return { kind: 'verifiedProfile', fragment: hash };
  }
  return null;
}

/**
 * `solidarity://…` / `airmeishi://…` routes only — split out of
 * `parseDeepLink` for the same reason `parseVerifiedDomainRoute` above was:
 * keep that function's cyclomatic complexity under budget as this branch
 * grows (card / group / and now pear, Task A5.4 US-20). `null` means
 * "recognised host, but no known route" — falls through to `unknown` at the
 * call site.
 */
function parseCustomSchemeRoute(url: URL): DeepLinkRoute | null {
  const segments = url.pathname.replace(/^\//u, '').split('/');
  const [first] = segments;
  if (url.host === 'card' && first && UUID_RE.test(first)) {
    return { kind: 'card', cardId: first };
  }
  if (url.host === 'group' && first) {
    return { kind: 'groupInvite', token: first };
  }
  // `solidarity://pear/<did>` (Task A5.4, US-20) — the public web viewer's
  // "Request private view" button target. `segments.length === 1` rejects
  // path traversal / extra segments (`/pear/<did>/extra`) rather than
  // silently taking the first and ignoring the rest.
  if (url.host === 'pear' && segments.length === 1 && first && isValidPearDid(first)) {
    return { kind: 'pear', did: first };
  }
  // `solidarity://websign?req=<X>` (research §4, App↔Web per-action signing) —
  // the same-device "deep link out" transport. `req` is the raw request
  // compact JWS or its compressed fragment form; it is decoded + verified by
  // the review flow, never trusted here. The web session signature does NOT
  // prove origin — the app's human-reviewed diff is the security boundary.
  if (url.host === WEBSIGN_DEEPLINK_HOST) {
    const req = url.searchParams.get(WEBSIGN_REQUEST_PARAM);
    return req !== null && req.length > 0 ? { kind: 'webSign', request: req } : null;
  }
  return null;
}

export function parseDeepLink(raw: string): DeepLinkRoute {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'unknown', raw };
  }

  // Android `singleTask` activities replay the original launch intent on every
  // resume from the launcher. If that intent was an OID4VP / OID4VCI URL, the
  // app re-routes into the credential flow on every cold start. Treat empty-
  // query URLs as stale launch intents — a real offer always carries a payload.
  if (url.protocol === 'openid4vp:' || url.protocol === 'openid-vp:') {
    const query = url.searchParams.toString();
    return query.length === 0 ? { kind: 'unknown', raw } : { kind: 'oidc', query };
  }
  if (url.protocol === 'openid-credential-offer:') {
    const query = url.searchParams.toString();
    const hasOfferPayload =
      url.searchParams.has('credential_offer') || url.searchParams.has('credential_offer_uri');
    return query.length === 0 || !hasOfferPayload
      ? { kind: 'unknown', raw }
      : { kind: 'credentialOffer', query };
  }

  if (url.protocol === 'solidarity:' || url.protocol === 'airmeishi:') {
    const route = parseCustomSchemeRoute(url);
    if (route !== null) return route;
  }

  if (url.protocol === 'https:' && isVerifiedDomain(url.host)) {
    const route = parseVerifiedDomainRoute(url);
    if (route !== null) return route;
  }

  return { kind: 'unknown', raw };
}
