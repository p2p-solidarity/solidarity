import { describe, expect, it } from 'bun:test';

import {
  badgeResultMatchesProfile,
  claimedBadgeProviders,
  verifyOnboardingBadge,
  type OnboardingBadgeVerificationDependencies,
} from '@/onboarding/badgeVerification';
import type {
  ProfileRecord,
  VerifyAtprotoBindingResult,
  VerifyNostrBindingResult,
} from '@solidarity/shared';

const HANDLE = 'alice.bsky.social';
const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqpqqenm';

function profile(alsoKnownAs: readonly string[]): ProfileRecord {
  return {
    v: 1,
    did: 'did:key:zDnaSolidarityProfileOwner',
    displayName: 'Alice',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [...alsoKnownAs],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-16T00:00:00.000Z',
  };
}

function atproto(state: VerifyAtprotoBindingResult['state']): VerifyAtprotoBindingResult {
  return {
    state,
    handle: HANDLE,
    evidence: {
      handleClaim: HANDLE,
      repoDid: 'did:plc:aliceexample1234',
      recordUri: null,
      direction1: true,
      direction2: state === 'verified' ? true : state === 'stale' ? null : false,
      reason: state,
    },
  };
}

function nostr(state: VerifyNostrBindingResult['state']): VerifyNostrBindingResult {
  return {
    state,
    npub: NPUB,
    evidence: {
      npubClaim: NPUB,
      pubkeyHex: '00'.repeat(32),
      direction1: true,
      direction2: state === 'verified' ? true : state === 'stale' ? null : false,
      kind0CreatedAt: null,
      reason: state,
    },
  };
}

function dependencies(
  events: string[],
  atprotoResult = atproto('declared'),
  nostrResult = nostr('verified')
): OnboardingBadgeVerificationDependencies {
  return {
    verifyAtproto: () => {
      events.push('bluesky');
      return Promise.resolve(atprotoResult);
    },
    verifyNostr: () => {
      events.push('nostr');
      return Promise.resolve(nostrResult);
    },
  };
}

describe('onboarding badge truth selection', () => {
  it('does no verifier IO when the profile has no badge claim', async () => {
    const events: string[] = [];
    const record = profile([]);

    expect(claimedBadgeProviders(record)).toEqual([]);
    expect(await verifyOnboardingBadge(record, null, dependencies(events))).toBeNull();
    expect(events).toEqual([]);
  });

  it('keeps the provider chosen in this onboarding run, even when its honest state is stale', async () => {
    const events: string[] = [];
    const record = profile([`at://${HANDLE}`, `nostr:${NPUB}`]);

    const result = await verifyOnboardingBadge(
      record,
      'bluesky',
      dependencies(events, atproto('stale'), nostr('verified'))
    );

    expect(result).toEqual({ provider: 'bluesky', result: atproto('stale') });
    expect(events).toEqual(['bluesky']);
  });

  it('on replay selects the strongest real verifier evidence, with Bluesky as the tie-break', async () => {
    const aliases = [`at://${HANDLE}`, `nostr:${NPUB}`];

    const strongest = await verifyOnboardingBadge(
      profile(aliases),
      null,
      dependencies([], atproto('declared'), nostr('verified'))
    );
    expect(strongest?.provider).toBe('nostr');

    const tied = await verifyOnboardingBadge(
      profile(aliases),
      null,
      dependencies([], atproto('verified'), nostr('verified'))
    );
    expect(tied?.provider).toBe('bluesky');
  });

  it('never reuses warm evidence after its claim no longer matches the current profile', () => {
    const current = profile([`at://different.bsky.social`]);

    expect(
      badgeResultMatchesProfile({ provider: 'bluesky', result: atproto('verified') }, current)
    ).toBe(false);
    expect(
      badgeResultMatchesProfile(
        { provider: 'nostr', result: nostr('verified') },
        profile([`nostr:${NPUB}`])
      )
    ).toBe(true);
  });

  it('does not show another provider as warm evidence once the selected provider has a claim', () => {
    const both = profile([`at://${HANDLE}`, `nostr:${NPUB}`]);

    expect(
      badgeResultMatchesProfile({ provider: 'nostr', result: nostr('verified') }, both, 'bluesky')
    ).toBe(false);
    expect(
      badgeResultMatchesProfile(
        { provider: 'nostr', result: nostr('verified') },
        profile([`nostr:${NPUB}`]),
        'bluesky'
      )
    ).toBe(true);
  });
});
