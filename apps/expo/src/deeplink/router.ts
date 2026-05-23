/**
 * Deep-link handler — wires the pure parser (./parser) into expo-router.
 * Mirrors Swift DeepLinkManager.shared.handleIncomingURL.
 */
import { router } from 'expo-router';

import { parseDeepLink, type DeepLinkRoute } from './parser';

export type { DeepLinkRoute };
export { parseDeepLink };

/** Side-effecting handler — call from a `useLinking()` listener. */
export function handleDeepLink(raw: string): DeepLinkRoute {
  const route = parseDeepLink(raw);
  switch (route.kind) {
    case 'card':
      router.push({ pathname: '/people/[id]', params: { id: route.cardId } });
      break;
    case 'groupInvite':
      router.push({ pathname: '/groups', params: { invite: route.token } });
      break;
    case 'oidc':
      router.push({ pathname: '/oidc/consent', params: { q: route.query } });
      break;
    case 'credentialOffer':
      router.push({ pathname: '/credentials/offer', params: { q: route.query } });
      break;
    case 'unknown':
      break;
  }
  return route;
}
