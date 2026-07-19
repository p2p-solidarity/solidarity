/**
 * Deep-link handler — wires the pure parser (./parser) into expo-router.
 * Mirrors Swift DeepLinkManager.shared.handleIncomingURL.
 */
import { router } from 'expo-router';

import { resolveProfileByHandle } from '@/handles/resolveProfile';
import { resolveProfileByNpub } from '@/nostr/resolveProfile';
import { presentVerifiedPageResolving, presentVerifiedPageResult } from '@/scan/verifiedPageResult';
import { verifyFragment } from '@/scan/verifiedPageHandler';
import { presentWebSignEntry } from '@/websign/pendingRequest';

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
    case 'verifiedPointer':
      // Short `#nostr:<npub>` form — open the sheet in its loading state,
      // then swap in the resolved verdict once relays answer (or an honest
      // unreachable/notFound/bindingMismatch). Fire-and-forget: the sheet is
      // store-driven, so it doesn't matter that `handleDeepLink` returns
      // before resolution completes. `resolveProfileByNpub` never throws.
      presentVerifiedPageResolving();
      void resolveProfileByNpub(route.npub).then(presentVerifiedPageResult);
      break;
    case 'verifiedHandle':
      presentVerifiedPageResolving();
      void resolveProfileByHandle(route.handle).then(presentVerifiedPageResult);
      break;
    case 'pear':
      // Task A5.4 (US-20) — reuse the Verified Page detail route: it already
      // renders the full card-exchange surface for a did with a saved
      // `VerifiedSnapshot`, and now also renders `PearConnectSection`'s
      // honest "connect privately" landing for a did with none (see that
      // screen's doc). Same route either way — the screen itself decides
      // which to show based on whether it already knows this did.
      router.push({ pathname: '/people/profile/[did]', params: { did: route.did } });
      break;
    case 'webSign':
      // App↔Web per-action signing (research §4, G3). Stage the request (or an
      // honest decode error) and open the consent review screen. The review
      // screen does the verify + per-field diff + Face-ID-gated root sign; the
      // web session signature never proves origin, so the diff is the boundary.
      presentWebSignEntry(route.request);
      router.push('/websign/review');
      break;
    case 'unknown':
      break;
  }
  return route;
}
