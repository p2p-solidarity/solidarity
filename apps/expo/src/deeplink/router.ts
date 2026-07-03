/**
 * Deep-link handler — wires the pure parser (./parser) into expo-router.
 * Mirrors Swift DeepLinkManager.shared.handleIncomingURL.
 */
import { router } from 'expo-router';

import { presentVerifiedPageResult } from '@/scan/verifiedPageResult';
import { verifyFragment } from '@/scan/verifiedPageHandler';

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
      router.push({ pathname: '/settings/groups', params: { invite: route.token } });
      break;
    case 'oidc':
      router.push({ pathname: '/oidc/consent', params: { q: route.query } });
      break;
    case 'credentialOffer':
      router.push({ pathname: '/credentials/offer', params: { q: route.query } });
      break;
    case 'verifiedProfile':
      // Same local-only verify pipeline the scanner uses, presented through
      // the same globally-mounted `VerifiedPageResultSheet` (`_layout.tsx`)
      // — no route push needed, the sheet reacts to the store regardless of
      // which screen is currently focused.
      presentVerifiedPageResult(verifyFragment(route.fragment));
      break;
    case 'unknown':
      break;
  }
  return route;
}
