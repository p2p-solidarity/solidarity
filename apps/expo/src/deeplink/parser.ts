/**
 * Deep-link parser — pure URL → route table, no React Native imports so
 * it tests cleanly under Bun without dragging the Flow-typed RN runtime.
 * The handler (with `router.push` side effects) lives in ./handler.
 */

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

  if (url.protocol === 'openid4vp:' || url.protocol === 'openid-vp:') {
    return { kind: 'oidc', query: url.searchParams.toString() };
  }
  if (url.protocol === 'openid-credential-offer:') {
    return { kind: 'credentialOffer', query: url.searchParams.toString() };
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

  if (url.protocol === 'https:' && url.host === 'solidarity.gg') {
    const segments = url.pathname.replace(/^\//u, '').split('/');
    if (segments[0] === 'c' && segments[1] && UUID_RE.test(segments[1])) {
      return { kind: 'card', cardId: segments[1] };
    }
  }

  return { kind: 'unknown', raw };
}
