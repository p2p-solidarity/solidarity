/**
 * Deep-link parser — pure URL → route table, no React Native imports so
 * it tests cleanly under Bun without dragging the Flow-typed RN runtime.
 * The handler (with `router.push` side effects) lives in ./handler.
 */
import { isVerifiedDomain } from './domainVerification';

export type DeepLinkRoute =
  | { readonly kind: 'card'; readonly cardId: string }
  | { readonly kind: 'groupInvite'; readonly token: string }
  | { readonly kind: 'oidc'; readonly query: string }
  | { readonly kind: 'credentialOffer'; readonly query: string }
  | { readonly kind: 'verifiedProfile'; readonly fragment: string }
  | { readonly kind: 'unknown'; readonly raw: string };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

/**
 * `https://<verified-domain>/...` routes only — split out of `parseDeepLink`
 * to keep that function's cyclomatic complexity under budget as this branch
 * grows (card link, and now the Verified Page fragment link, 1.3.3 Task
 * A2.3 US-11). `null` means "recognised host, but no known route" — falls
 * through to `unknown` at the call site.
 */
function parseVerifiedDomainRoute(url: URL): DeepLinkRoute | null {
  const segments = url.pathname.replace(/^\//u, '').split('/');
  if (segments[0] === 'c' && segments[1] && UUID_RE.test(segments[1])) {
    return { kind: 'card', cardId: segments[1] };
  }
  // Verified Page link (1.3.3 Task A2.3, US-11): `https://solidarity.gg/#<fragment>`
  // — the fragment never leaves the device over the network (01-spec §1/§8),
  // so this is just recognising the shape and handing the raw fragment blob
  // to the same local-only verify pipeline the scanner uses
  // (`src/scan/verifiedPageHandler.ts`'s `verifyFragment`).
  if (url.hash.length > 1) {
    return { kind: 'verifiedProfile', fragment: url.hash.slice(1) };
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
    const [first] = url.pathname.replace(/^\//u, '').split('/');
    if (url.host === 'card' && first && UUID_RE.test(first)) {
      return { kind: 'card', cardId: first };
    }
    if (url.host === 'group' && first) {
      return { kind: 'groupInvite', token: first };
    }
  }

  if (url.protocol === 'https:' && isVerifiedDomain(url.host)) {
    const route = parseVerifiedDomainRoute(url);
    if (route !== null) return route;
  }

  return { kind: 'unknown', raw };
}
