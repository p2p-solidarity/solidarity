import { describe, expect, it } from 'bun:test';

import { atprotoBadgeViewModel, type AtprotoBadgeVisual } from '@/badges/atprotoBadgeDisplay';
import type { BadgeState, VerifyAtprotoBindingResult } from '@solidarity/shared';

const VERIFIED: VerifyAtprotoBindingResult = {
  state: 'verified',
  handle: 'alice.bsky.social',
  evidence: {
    handleClaim: 'alice.bsky.social',
    repoDid: 'did:plc:alice',
    recordUri: 'at://did:plc:alice/app.solidarity.profile/self',
    direction1: true,
    direction2: true,
    reason: 'both directions confirmed',
  },
};

function resultFor(state: BadgeState): VerifyAtprotoBindingResult {
  return {
    ...VERIFIED,
    state,
    evidence: {
      ...VERIFIED.evidence,
      direction2: state === 'verified' ? true : state === 'stale' ? null : false,
    },
  };
}

describe('atprotoBadgeViewModel', () => {
  it('maps a bidirectionally verified binding to the verified visual and preserves its evidence', () => {
    expect(atprotoBadgeViewModel(VERIFIED, false)).toEqual({
      visual: 'verified',
      handle: 'alice.bsky.social',
      repoDid: 'did:plc:alice',
      recordUri: 'at://did:plc:alice/app.solidarity.profile/self',
      direction1: true,
      direction2: true,
    });
  });

  it('hides a verifier result whose profile has no at:// handle claim', () => {
    const noClaim: VerifyAtprotoBindingResult = {
      state: 'declared',
      handle: null,
      evidence: {
        handleClaim: null,
        repoDid: null,
        recordUri: null,
        direction1: false,
        direction2: null,
        reason: 'no claim',
      },
    };

    expect(atprotoBadgeViewModel(noClaim, true).visual).toBe('hidden');
  });

  it('keeps verified, declared, and stale visually distinct and fails revoked closed', () => {
    const cases: readonly (readonly [BadgeState, AtprotoBadgeVisual])[] = [
      ['verified', 'verified'],
      ['declared', 'declared'],
      ['stale', 'stale'],
      ['revoked', 'declared'],
    ];

    for (const [state, visual] of cases) {
      expect(atprotoBadgeViewModel(resultFor(state), false).visual).toBe(visual);
    }
  });

  it('shows loading only before the first result and keeps a warm result during revalidation', () => {
    expect(atprotoBadgeViewModel(null, true).visual).toBe('loading');
    expect(atprotoBadgeViewModel(null, false).visual).toBe('hidden');
    expect(atprotoBadgeViewModel(resultFor('stale'), true).visual).toBe('stale');
  });
});
