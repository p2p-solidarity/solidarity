const UNLOCK_TAP_COUNT = 5;
const COUNTDOWN_START_TAP = 3;

export type DeveloperUnlockEffect =
  | { readonly kind: 'none' }
  | { readonly kind: 'countdown'; readonly remaining: 1 | 2 }
  | { readonly kind: 'enabled' };

export interface DeveloperUnlockTransition {
  readonly nextTapCount: number;
  readonly effect: DeveloperUnlockEffect;
}

/** Pure state transition for the hidden five-tap Version entry. */
export function advanceDeveloperUnlock(
  currentTapCount: number,
  developerMode: boolean,
): DeveloperUnlockTransition {
  if (developerMode) {
    return { nextTapCount: currentTapCount, effect: { kind: 'none' } };
  }

  const nextTapCount = currentTapCount + 1;
  if (nextTapCount >= UNLOCK_TAP_COUNT) {
    return { nextTapCount: 0, effect: { kind: 'enabled' } };
  }

  if (nextTapCount >= COUNTDOWN_START_TAP) {
    return {
      nextTapCount,
      effect: {
        kind: 'countdown',
        remaining: (UNLOCK_TAP_COUNT - nextTapCount) as 1 | 2,
      },
    };
  }

  return { nextTapCount, effect: { kind: 'none' } };
}
