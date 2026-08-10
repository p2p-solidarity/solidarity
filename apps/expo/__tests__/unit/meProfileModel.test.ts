import { describe, expect, it } from 'bun:test';

import {
  buildProfileShareModel,
  handleShareCandidates,
  preferredVerifiedHandleShareCandidate,
  profileIdentityLine,
  selectProfileShareUrl,
  verifiedHandleShareCandidates,
  type HandleShareCandidate,
} from '@/components/me/meProfileModel';
import { encodeFragment, type ProfileRecord } from '@solidarity/shared';

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

  it('builds /name from the signed public projection, never the broader QR projection', () => {
    const sharedJws = 'header.shared.signature';
    const publicJws = 'header.public.signature';
    const shared = {
      ...PROFILE,
      scope: 'shared' as const,
      links: [
        { label: 'Public', url: 'https://public.example' },
        { label: 'Card only', url: 'https://card-only.example' },
      ],
    };
    const publicProjection = {
      ...PROFILE,
      scope: 'public' as const,
      links: [{ label: 'Public', url: 'https://public.example' }],
    };

    const model = buildProfileShareModel(shared, sharedJws, 'alice', {
      record: publicProjection,
      jws: publicJws,
    });

    expect(model.usernameUrl).toBe(`https://creds.id/alice#${encodeFragment(publicJws).fragment}`);
    expect(model.usernameUrl).not.toContain(encodeFragment(sharedJws).fragment);
  });

  it('withholds /name until there is a separately signed public projection', () => {
    const model = buildProfileShareModel(PROFILE, 'header.payload.signature', 'alice');

    expect(model.usernameUrl).toBeNull();
    expect(model.usernameDisplayUrl).toBeNull();
  });
});

describe('handleShareCandidates', () => {
  it('derives a bare @handle URL for an atproto claim', () => {
    const candidates = handleShareCandidates({
      ...PROFILE,
      alsoKnownAs: ['at://alice.bsky.social'],
    });
    expect(candidates).toEqual([
      {
        scheme: 'atproto',
        handle: 'alice.bsky.social',
        url: 'https://app.solidarity.gg/@alice.bsky.social',
      },
    ]);
  });

  it('derives a bare @handle URL for an ens claim (.eth is an unambiguous suffix)', () => {
    const candidates = handleShareCandidates({ ...PROFILE, alsoKnownAs: ['ens:alice.eth'] });
    expect(candidates).toEqual([
      { scheme: 'ens', handle: 'alice.eth', url: 'https://app.solidarity.gg/@alice.eth' },
    ]);
  });

  it('keeps the explicit dns: scheme prefix for a dns claim — a bare domain would misroute to atproto', () => {
    const candidates = handleShareCandidates({ ...PROFILE, alsoKnownAs: ['dns:example.com'] });
    expect(candidates).toEqual([
      {
        scheme: 'dns',
        handle: 'example.com',
        url: 'https://app.solidarity.gg/@dns:example.com',
      },
    ]);
    // The raw `:` is a valid RFC 3986 pchar and needs no percent-encoding —
    // it survives an actual URL parse unescaped.
    expect(new URL(candidates[0]!.url).pathname).toBe('/@dns:example.com');
  });

  it('orders candidates atproto > ens > dns (D6 Bluesky-spine-first / grill G5)', () => {
    const candidates = handleShareCandidates({
      ...PROFILE,
      alsoKnownAs: ['dns:example.com', 'ens:alice.eth', 'at://alice.bsky.social'],
    });
    expect(candidates.map((c) => c.scheme)).toEqual(['atproto', 'ens', 'dns']);
  });

  it('drops a malformed dns claim rather than offering a broken link', () => {
    expect(handleShareCandidates({ ...PROFILE, alsoKnownAs: ['dns:not a domain'] })).toEqual([]);
  });

  it('drops a candidate whose bare form would round-trip to a DIFFERENT scheme', () => {
    // `weird.eth` is a structurally valid atproto handle, but a bare
    // `@weird.eth` would resolve via the ENS resolver (unambiguous `.eth`
    // suffix wins first) — offering it as an atproto share link would be
    // dishonest, so it must be dropped rather than mis-encoded.
    expect(handleShareCandidates({ ...PROFILE, alsoKnownAs: ['at://weird.eth'] })).toEqual([]);
  });

  it('returns no candidates when no handle claim exists — matches pre-existing behaviour', () => {
    expect(handleShareCandidates(PROFILE)).toEqual([]);
  });
});

describe('verified handle share gate', () => {
  const CANDIDATE_RECORD: ProfileRecord = {
    ...PROFILE,
    alsoKnownAs: ['at://alice.bsky.social', 'ens:alice.eth', 'dns:example.com'],
  };

  it('offers nothing when no candidate is verified — identical to no-handle behaviour', () => {
    expect(verifiedHandleShareCandidates(CANDIDATE_RECORD, () => false)).toEqual([]);
    expect(preferredVerifiedHandleShareCandidate(CANDIDATE_RECORD, () => false)).toBeNull();
  });

  it('never offers a declared/stale/revoked binding — only exactly verified passes the gate', () => {
    const stateByHandle: Record<string, 'verified' | 'declared' | 'stale' | 'revoked'> = {
      'alice.bsky.social': 'declared',
      'alice.eth': 'stale',
      'example.com': 'revoked',
    };
    const isVerified = (candidate: HandleShareCandidate) =>
      stateByHandle[candidate.handle] === 'verified';

    expect(verifiedHandleShareCandidates(CANDIDATE_RECORD, isVerified)).toEqual([]);
    expect(preferredVerifiedHandleShareCandidate(CANDIDATE_RECORD, isVerified)).toBeNull();
  });

  it('prefers the highest-priority VERIFIED candidate, skipping unverified higher-priority ones', () => {
    const isVerified = (candidate: HandleShareCandidate) => candidate.scheme === 'dns';

    const preferred = preferredVerifiedHandleShareCandidate(CANDIDATE_RECORD, isVerified);
    expect(preferred?.scheme).toBe('dns');
    expect(verifiedHandleShareCandidates(CANDIDATE_RECORD, isVerified).map((c) => c.scheme)).toEqual([
      'dns',
    ]);
  });

  it('offers the top-priority candidate first when multiple are verified', () => {
    const preferred = preferredVerifiedHandleShareCandidate(CANDIDATE_RECORD, () => true);
    expect(preferred?.scheme).toBe('atproto');
  });
});
