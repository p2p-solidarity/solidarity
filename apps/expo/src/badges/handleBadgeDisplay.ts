import type { BadgeState } from '@solidarity/shared';

export interface HandleBadgeViewModel {
  readonly visual: BadgeState;
  readonly labelKey:
    | 'verifiedPage.handleBadge.verified'
    | 'verifiedPage.handleBadge.declared'
    | 'verifiedPage.handleBadge.stale'
    | 'verifiedPage.handleBadge.revoked';
}

export function handleBadgeViewModel(state: BadgeState): HandleBadgeViewModel {
  switch (state) {
    case 'verified':
      return { visual: 'verified', labelKey: 'verifiedPage.handleBadge.verified' };
    case 'declared':
      return { visual: 'declared', labelKey: 'verifiedPage.handleBadge.declared' };
    case 'stale':
      return { visual: 'stale', labelKey: 'verifiedPage.handleBadge.stale' };
    case 'revoked':
      return { visual: 'revoked', labelKey: 'verifiedPage.handleBadge.revoked' };
  }
}
