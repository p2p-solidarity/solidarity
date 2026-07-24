import {
  BADGE_REVERIFY_TTL_MS,
  getBadgeStatusCacheRevision,
  readCachedAtprotoResult,
  subscribeBadgeStatusCache,
} from '@/badges/badgeStatusCache';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ProfileRecord } from '@solidarity/shared';

import { preferredVerifiedHandleShareUrl } from './handleShareVerification';
import {
  buildProfileShareModel,
  buildProfileShareUrlSelection,
  type HandleShareCandidate,
  type ProfileShareModel,
  type ProfileShareUrlCandidate,
} from './meProfileModel';

export type ProfileShareSelectionState =
  | {
      readonly kind: 'ready';
      readonly model: ProfileShareModel;
      readonly candidates: readonly ProfileShareUrlCandidate[];
      readonly selected: ProfileShareUrlCandidate;
      readonly verifiedHandle: HandleShareCandidate | null;
    }
  | { readonly kind: 'error' };

/**
 * One reactive honesty boundary for every Me-page URL surface.
 *
 * Cache writes trigger an immediate external-store update. A fresh verified
 * handle also schedules its own TTL expiry, so leaving Me mounted cannot keep
 * an alias copyable after its 15-minute evidence window closes.
 */
export function useProfileShareSelection(
  record: ProfileRecord,
  jws: string,
  nostrShortUrlReady: boolean,
  retryNonce = 0
): ProfileShareSelectionState {
  const cacheRevision = useSyncExternalStore(
    subscribeBadgeStatusCache,
    getBadgeStatusCacheRevision,
    getBadgeStatusCacheRevision
  );
  const [expiryTick, setExpiryTick] = useState(0);

  const verifiedHandle = useMemo(
    () => preferredVerifiedHandleShareUrl(record),
    [cacheRevision, expiryTick, record]
  );
  const verifiedHandleExpiresAt =
    verifiedHandle === null
      ? null
      : (readCachedAtprotoResult()?.checkedAt ?? 0) + BADGE_REVERIFY_TTL_MS;

  useEffect(() => {
    if (verifiedHandleExpiresAt === null) return;
    const remainingMs = verifiedHandleExpiresAt - Date.now();
    if (remainingMs <= 0) return;
    const timer = setTimeout(() => {
      setExpiryTick((value) => value + 1);
    }, remainingMs + 1);
    return () => {
      clearTimeout(timer);
    };
  }, [cacheRevision, expiryTick, verifiedHandleExpiresAt]);

  return useMemo(() => {
    if (jws.length === 0) return { kind: 'error' };
    try {
      const model = buildProfileShareModel(record, jws);
      const resolved = buildProfileShareUrlSelection(
        model,
        verifiedHandle,
        nostrShortUrlReady
      );
      if (resolved.selection.kind === 'error') return { kind: 'error' };
      return {
        kind: 'ready',
        model,
        candidates: resolved.candidates,
        selected: resolved.selection.candidate,
        verifiedHandle,
      };
    } catch {
      return { kind: 'error' };
    }
  }, [
    cacheRevision,
    expiryTick,
    jws,
    nostrShortUrlReady,
    record,
    retryNonce,
    verifiedHandle,
  ]);
}
