import { describe, expect, it } from 'bun:test';

import { handleBadgeViewModel } from '@/badges/handleBadgeDisplay';
import type { BadgeState } from '@solidarity/shared';

describe('handleBadgeViewModel', () => {
  it('awards the green visual only to exactly verified', () => {
    const states: readonly BadgeState[] = ['verified', 'declared', 'stale', 'revoked'];
    const models = states.map(handleBadgeViewModel);

    expect(models.filter((model) => model.visual === 'verified')).toHaveLength(1);
    expect(models.map((model) => model.visual)).toEqual([
      'verified',
      'declared',
      'stale',
      'revoked',
    ]);
    expect(models.map((model) => model.labelKey)).toEqual([
      'verifiedPage.handleBadge.verified',
      'verifiedPage.handleBadge.declared',
      'verifiedPage.handleBadge.stale',
      'verifiedPage.handleBadge.revoked',
    ]);
  });
});
