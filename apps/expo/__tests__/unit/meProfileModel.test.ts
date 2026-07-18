import { describe, expect, it } from 'bun:test';

import {
  buildProfileShareModel,
  profileIdentityLine,
  selectProfileShareUrl,
} from '@/components/me/meProfileModel';
import type { ProfileRecord } from '@solidarity/shared';

const PROFILE: ProfileRecord = {
  v: 1,
  did: 'did:key:z6MkrJYzZkexamplelongidentifier',
  displayName: 'Alice',
  avatar: null,
  bio: 'Portable by default.',
  links: [],
  alsoKnownAs: [],
  badges: [],
  supersededBy: null,
  updatedAt: '2026-07-16T00:00:00.000Z',
};

describe('profileIdentityLine', () => {
  it('prefers the profile-owned Bluesky handle and otherwise falls back to a short DID', () => {
    expect(
      profileIdentityLine({
        ...PROFILE,
        alsoKnownAs: ['at://alice.bsky.social'],
      })
    ).toEqual({ kind: 'handle', label: '@alice.bsky.social' });

    expect(
      profileIdentityLine({
        ...PROFILE,
        alsoKnownAs: ['at://@Alice.BSKY.Social'],
      })
    ).toEqual({ kind: 'handle', label: '@alice.bsky.social' });

    expect(profileIdentityLine(PROFILE)).toEqual({
      kind: 'did',
      label: 'did:key:z6Mk...tifier',
    });

    expect(
      profileIdentityLine({
        ...PROFILE,
        alsoKnownAs: ['at://not a handle'],
      })
    ).toEqual({ kind: 'did', label: 'did:key:z6Mk...tifier' });
  });
});

describe('profile share model', () => {
  it('offers the Nostr pointer when published while retaining the self-contained offline fragment', () => {
    const model = buildProfileShareModel(
      { ...PROFILE, alsoKnownAs: ['nostr:npub1alice'] },
      'header.payload.signature'
    );

    expect(model.shortUrl).toBe('https://app.solidarity.gg/#nostr:npub1alice');
    expect(model.offlineUrl.startsWith('https://app.solidarity.gg/#')).toBe(true);
    expect(model.offlineUrl).not.toContain('SOLIDARITY::');
    expect(selectProfileShareUrl(model, true)).toBe('https://app.solidarity.gg/#nostr:npub1alice');
    expect(selectProfileShareUrl(model, false)).toBe(model.offlineUrl);
  });
});
