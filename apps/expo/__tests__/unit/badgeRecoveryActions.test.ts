import { describe, expect, it } from 'bun:test';

import { badgeRecoveryActions } from '@/components/me/badgeRecoveryActions';

describe('badgeRecoveryActions', () => {
  it('offers only actions that match the observed verification failure direction', () => {
    expect(
      badgeRecoveryActions({
        platform: 'nostr',
        visual: 'stale',
        direction1: true,
        direction2: null,
      })
    ).toEqual(['retry']);
    expect(
      badgeRecoveryActions({
        platform: 'nostr',
        visual: 'declared',
        direction1: true,
        direction2: false,
      })
    ).toEqual(['retry', 'republish']);
    expect(
      badgeRecoveryActions({
        platform: 'bluesky',
        visual: 'declared',
        direction1: true,
        direction2: false,
      })
    ).toEqual(['retry', 'reconnectBluesky']);
    expect(
      badgeRecoveryActions({
        platform: 'bluesky',
        visual: 'stale',
        direction1: true,
        direction2: null,
      })
    ).toEqual(['retry']);
    expect(
      badgeRecoveryActions({
        platform: 'nostr',
        visual: 'verified',
        direction1: true,
        direction2: true,
      })
    ).toEqual([]);
  });
});
