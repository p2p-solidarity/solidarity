import { router } from 'expo-router';

import { useIsPro } from './entitlementStore';

export interface ProGate {
  /** Whether the current user is entitled (includes the offline grace window). */
  readonly isPro: boolean;
  /** True when a control that requires Pro must be locked for this user. */
  readonly locked: (requiresPro: boolean) => boolean;
  /** Send the user to the paywall. The only thing a locked control does. */
  readonly openUpgrade: () => void;
}

/**
 * The single place a Pro feature gate is expressed.
 *
 * Locking only ever affects *controls*. A block or style a subscriber already
 * applied stays in their design and stays published after a lapse — see
 * `entitlement.ts` rule 1. Nothing that reads this hook may delete or rewrite
 * user content on downgrade.
 */
export function useProGate(): ProGate {
  const isPro = useIsPro();
  return {
    isPro,
    locked: (requiresPro: boolean) => requiresPro && !isPro,
    openUpgrade: () => {
      router.push('/settings/pro');
    },
  };
}
