import { afterEach, describe, expect, it } from 'bun:test';

import {
  __setBadgeStatusCacheStorageForTesting,
  BADGE_REVERIFY_TTL_MS,
  captureBadgeStatusCacheEpoch,
  invalidateCachedNostrResult,
  getBadgeStatusCacheRevision,
  readCachedAtprotoResult,
  readCachedNostrResult,
  shouldReverifyBadge,
  subscribeBadgeStatusCache,
  writeCachedAtprotoResult,
  writeCachedNostrResult,
  type BadgeStatusCacheStorage,
} from '../../src/badges/badgeStatusCache';
import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';
import type {
  VerifyAtprotoBindingResult,
  VerifyNostrBindingResult,
} from '@solidarity/shared';

function memoryStorage(): { storage: BadgeStatusCacheStorage; map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getString: (key) => map.get(key) ?? null,
      setString: (key, value) => {
        map.set(key, value);
      },
      removeKey: (key) => {
        map.delete(key);
      },
    },
  };
}

const nostrResult = {
  state: 'verified',
  npub: 'npub1example',
  evidence: { direction1: true },
} as unknown as VerifyNostrBindingResult;

const atprotoResult = {
  state: 'verified',
  evidence: { handleClaim: 'alice.bsky.social' },
} as unknown as VerifyAtprotoBindingResult;

afterEach(() => {
  __setBadgeStatusCacheStorageForTesting(null);
  __resetLocalDataWipeBarrierForTesting();
});

describe('badgeStatusCache', () => {
  it('round-trips the last completed result with its checkedAt timestamp', () => {
    const { storage } = memoryStorage();
    __setBadgeStatusCacheStorageForTesting(storage);

    writeCachedNostrResult(nostrResult, 1_700_000_000_000);
    expect(readCachedNostrResult()).toEqual({
      checkedAt: 1_700_000_000_000,
      result: nostrResult,
    });

    writeCachedAtprotoResult(atprotoResult, 1_700_000_000_001);
    expect(readCachedAtprotoResult()).toEqual({
      checkedAt: 1_700_000_000_001,
      result: atprotoResult,
    });
  });

  it('overwrites with the latest completed check — last KNOWN state, not last good', () => {
    const { storage } = memoryStorage();
    __setBadgeStatusCacheStorageForTesting(storage);

    writeCachedNostrResult(nostrResult, 1);
    const downgraded = { ...nostrResult, state: 'stale' } as VerifyNostrBindingResult;
    writeCachedNostrResult(downgraded, 2);
    expect(readCachedNostrResult()).toEqual({ checkedAt: 2, result: downgraded });
  });

  it('degrades corrupted or foreign-shaped entries to null, never a throw', () => {
    const { storage, map } = memoryStorage();
    __setBadgeStatusCacheStorageForTesting(storage);

    map.set('badges:nostr:lastResult:v1', 'not json {{');
    expect(readCachedNostrResult()).toBeNull();

    map.set('badges:nostr:lastResult:v1', JSON.stringify({ checkedAt: 'yesterday', result: nostrResult }));
    expect(readCachedNostrResult()).toBeNull();

    map.set('badges:nostr:lastResult:v1', JSON.stringify({ checkedAt: 1, result: { unrelated: true } }));
    expect(readCachedNostrResult()).toBeNull();

    map.set('badges:atproto:lastResult:v1', JSON.stringify({ checkedAt: 1, result: null }));
    expect(readCachedAtprotoResult()).toBeNull();
  });

  it('reads null when the cache was never warmed (default storage, cold)', () => {
    // No override: the default MMKV-backed storage is cold in tests and
    // must degrade to null, never a fabricated result.
    expect(readCachedNostrResult()).toBeNull();
    expect(readCachedAtprotoResult()).toBeNull();
  });

  it('invalidateCachedNostrResult clears only the nostr entry (post-publish)', () => {
    const { storage } = memoryStorage();
    __setBadgeStatusCacheStorageForTesting(storage);

    writeCachedNostrResult(nostrResult, 1);
    writeCachedAtprotoResult(atprotoResult, 1);
    invalidateCachedNostrResult();

    expect(readCachedNostrResult()).toBeNull();
    expect(readCachedAtprotoResult()).not.toBeNull();
  });

  it('notifies mounted consumers when a verification result changes or is invalidated', () => {
    const { storage } = memoryStorage();
    __setBadgeStatusCacheStorageForTesting(storage);
    const seen: number[] = [];
    const unsubscribe = subscribeBadgeStatusCache(() => {
      seen.push(getBadgeStatusCacheRevision());
    });

    writeCachedAtprotoResult(atprotoResult, 1);
    writeCachedNostrResult(nostrResult, 2);
    invalidateCachedNostrResult();
    unsubscribe();
    writeCachedAtprotoResult(atprotoResult, 3);

    expect(seen).toHaveLength(3);
    expect(seen[0]).toBeLessThan(seen[1] ?? 0);
    expect(seen[1]).toBeLessThan(seen[2] ?? 0);
  });

  it('drops a verification that completes after a local-data wipe began', () => {
    const { storage } = memoryStorage();
    __setBadgeStatusCacheStorageForTesting(storage);
    const verificationEpoch = captureBadgeStatusCacheEpoch();

    beginLocalDataWipe();
    invalidateCachedNostrResult();
    completeLocalDataWipe();
    writeCachedNostrResult(nostrResult, 2, verificationEpoch);

    expect(readCachedNostrResult()).toBeNull();
  });
});

describe('shouldReverifyBadge', () => {
  const RECORD_AT = '2026-07-17T10:00:00.000Z';
  const RECORD_AT_MS = Date.parse(RECORD_AT);

  it('trusts a fresh check made after the record was signed', () => {
    const checkedAt = RECORD_AT_MS + 1_000;
    expect(shouldReverifyBadge(checkedAt, RECORD_AT, checkedAt + 60_000)).toBe(false);
  });

  it('re-verifies with no completed check', () => {
    expect(shouldReverifyBadge(null, RECORD_AT, RECORD_AT_MS)).toBe(true);
  });

  it('re-verifies once the TTL has elapsed', () => {
    const checkedAt = RECORD_AT_MS + 1_000;
    expect(shouldReverifyBadge(checkedAt, RECORD_AT, checkedAt + BADGE_REVERIFY_TTL_MS)).toBe(true);
    expect(
      shouldReverifyBadge(checkedAt, RECORD_AT, checkedAt + BADGE_REVERIFY_TTL_MS - 1)
    ).toBe(false);
  });

  it('re-verifies when the record was re-signed AFTER the cached check', () => {
    const checkedAt = RECORD_AT_MS - 1_000;
    expect(shouldReverifyBadge(checkedAt, RECORD_AT, RECORD_AT_MS)).toBe(true);
  });

  it('fails toward checking on an unparseable updatedAt — never toward trusting', () => {
    expect(shouldReverifyBadge(1_000, 'not-a-date', 2_000)).toBe(true);
  });
});
