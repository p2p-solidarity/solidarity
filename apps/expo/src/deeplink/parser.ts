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
  | { readonly kind: 'unknown'; readonly raw: string };

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

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
    return query.length === 0
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
    const segments = url.pathname.replace(/^\//u, '').split('/');
    if (segments[0] === 'c' && segments[1] && UUID_RE.test(segments[1])) {
      return { kind: 'card', cardId: segments[1] };
    }
  }

  return { kind: 'unknown', raw };
}
