/**
 * The real, cache-backed handle-share verified gate — reuses the S8h
 * `badgeStatusCache` pattern (fresh cached `verified` state, claim match,
 * never a live re-verify at share time). See `badgeStatusCache.test.ts`
 * for the underlying cache primitives this builds on.
 */
import { afterEach, describe, expect, it } from 'bun:test';

import {
  __setBadgeStatusCacheStorageForTesting,
  BADGE_REVERIFY_TTL_MS,
  writeCachedAtprotoResult,
  type BadgeStatusCacheStorage,
} from '@/badges/badgeStatusCache';
import {
  isHandleShareCandidateVerified,
  preferredVerifiedHandleShareUrl,
} from '@/components/me/handleShareVerification';
import type { HandleShareCandidate } from '@/components/me/meProfileModel';
import type { ProfileRecord, VerifyAtprotoBindingResult } from '@solidarity/shared';

function memoryStorage(): BadgeStatusCacheStorage {
  const map = new Map<string, string>();
  return {
    getString: (key) => map.get(key) ?? null,
    setString: (key, value) => {
      map.set(key, value);
    },
    removeKey: (key) => {
      map.delete(key);
    },
  };
}

function atprotoResult(handleClaim: string | null, state: VerifyAtprotoBindingResult['state']) {
  return {
    state,
    handle: handleClaim,
    evidence: {
      handleClaim,
      repoDid: 'did:plc:example',
      recordUri: 'at://did:plc:example/app.solidarity.profile/self',
      direction1: true,
      direction2: state === 'verified',
      reason: 'test fixture',
    },
  } as unknown as VerifyAtprotoBindingResult;
}

// `isHandleShareCandidateVerified` calls the real `Date.now()` internally
// (matching the production wiring in `ProfileBadgeChips.tsx`), so "fresh"
// fixtures below are computed relative to the actual wall clock at test
// run time, NOT a fixed historical date — a fixed date would silently go
// stale (past the 15-minute TTL) the moment real time moves past it.
const RECORD_UPDATED_AT_MS = Date.now() - 60_000;
/** After `RECORD_UPDATED_AT_MS` (the check ran AFTER the record was last
 *  signed) and well within `BADGE_REVERIFY_TTL_MS` of "now". */
const FRESH_CHECKED_AT_MS = Date.now() - 5_000;

const RECORD: ProfileRecord = {
  v: 1,
  did: 'did:key:z6MkrJYzZkexamplelongidentifier',
  displayName: 'Alice',
  avatar: null,
  bio: '',
  links: [],
  alsoKnownAs: ['at://alice.bsky.social', 'ens:alice.eth', 'dns:example.com'],
  badges: [],
  supersededBy: null,
  updatedAt: new Date(RECORD_UPDATED_AT_MS).toISOString(),
};

const ATPROTO_CANDIDATE: HandleShareCandidate = {
  scheme: 'atproto',
  handle: 'alice.bsky.social',
  url: 'https://app.solidarity.gg/@alice.bsky.social',
};
const ENS_CANDIDATE: HandleShareCandidate = {
  scheme: 'ens',
  handle: 'alice.eth',
  url: 'https://app.solidarity.gg/@alice.eth',
};
const DNS_CANDIDATE: HandleShareCandidate = {
  scheme: 'dns',
  handle: 'example.com',
  url: 'https://app.solidarity.gg/@dns:example.com',
};

afterEach(() => {
  __setBadgeStatusCacheStorageForTesting(null);
});

describe('isHandleShareCandidateVerified — atproto', () => {
  it('is false with no cached check at all (cold cache — matches pre-existing behaviour)', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    expect(isHandleShareCandidateVerified(RECORD, ATPROTO_CANDIDATE)).toBe(false);
  });

  it('is true for a fresh, claim-matching, exactly-verified cached result', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    writeCachedAtprotoResult(
      atprotoResult('alice.bsky.social', 'verified'),
      FRESH_CHECKED_AT_MS
    );
    expect(isHandleShareCandidateVerified(RECORD, ATPROTO_CANDIDATE)).toBe(true);
  });

  it('normalizes the cached RAW claim (case / leading @) before comparing', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    writeCachedAtprotoResult(
      atprotoResult('@Alice.BSKY.Social', 'verified'),
      FRESH_CHECKED_AT_MS
    );
    expect(isHandleShareCandidateVerified(RECORD, ATPROTO_CANDIDATE)).toBe(true);
  });

  it.each(['declared', 'stale', 'revoked'] as const)(
    'never offers a %s binding — only exactly verified passes the gate',
    (state) => {
      __setBadgeStatusCacheStorageForTesting(memoryStorage());
      writeCachedAtprotoResult(
        atprotoResult('alice.bsky.social', state),
        FRESH_CHECKED_AT_MS
      );
      expect(isHandleShareCandidateVerified(RECORD, ATPROTO_CANDIDATE)).toBe(false);
    }
  );

  it('is false when the cached claim no longer matches the candidate handle', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    writeCachedAtprotoResult(
      atprotoResult('someoneelse.bsky.social', 'verified'),
      FRESH_CHECKED_AT_MS
    );
    expect(isHandleShareCandidateVerified(RECORD, ATPROTO_CANDIDATE)).toBe(false);
  });

  it('is false once the cached check has aged past the TTL — never trusted stale-forever', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    const checkedAt = FRESH_CHECKED_AT_MS;
    writeCachedAtprotoResult(atprotoResult('alice.bsky.social', 'verified'), checkedAt);
    expect(
      isHandleShareCandidateVerified(
        { ...RECORD, updatedAt: new Date(checkedAt + BADGE_REVERIFY_TTL_MS).toISOString() },
        ATPROTO_CANDIDATE
      )
    ).toBe(false);
  });

  it('never triggers a live check itself — only reads whatever is already cached', () => {
    // No warm/writer call at all: a cold cache must degrade to `false`,
    // never fabricate a result or attempt network IO (S8h regression guard).
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    expect(isHandleShareCandidateVerified(RECORD, ATPROTO_CANDIDATE)).toBe(false);
  });
});

describe('isHandleShareCandidateVerified — ens / dns', () => {
  it('is always false: no own-profile verification loop is wired for these schemes yet', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    expect(isHandleShareCandidateVerified(RECORD, ENS_CANDIDATE)).toBe(false);
    expect(isHandleShareCandidateVerified(RECORD, DNS_CANDIDATE)).toBe(false);
  });
});

describe('preferredVerifiedHandleShareUrl', () => {
  it('returns null when nothing is verified — share UI behaves exactly as before this form existed', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    expect(preferredVerifiedHandleShareUrl(RECORD)).toBeNull();
  });

  it('returns the atproto candidate once its binding is verified and fresh', () => {
    __setBadgeStatusCacheStorageForTesting(memoryStorage());
    writeCachedAtprotoResult(
      atprotoResult('alice.bsky.social', 'verified'),
      FRESH_CHECKED_AT_MS
    );
    expect(preferredVerifiedHandleShareUrl(RECORD)).toEqual(ATPROTO_CANDIDATE);
  });
});
