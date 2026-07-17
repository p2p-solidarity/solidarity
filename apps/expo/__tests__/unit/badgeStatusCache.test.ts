import { afterEach, describe, expect, it } from 'bun:test';

import {
  __setBadgeStatusCacheStorageForTesting,
  readCachedAtprotoResult,
  readCachedNostrResult,
  writeCachedAtprotoResult,
  writeCachedNostrResult,
  type BadgeStatusCacheStorage,
} from '../../src/badges/badgeStatusCache';
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
});
