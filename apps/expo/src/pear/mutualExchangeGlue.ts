/**
 * Store glue for `mutualExchange.ts` (T5) — the two injection points that the
 * pure exchange module deliberately does NOT reach for itself: OUR card to
 * offer (from `profile/store`) and the save of a verified incoming card
 * (through the Part-A `mergeVerified` freshness/conflict policy in
 * `people/profileSnapshots`). Kept out of the protocol module so the wire
 * logic stays store-free and unit-testable; kept out of the hooks so both the
 * initiator (`useMutualCardExchange`) and the responder (`useReachableMode`)
 * share ONE definition of "how we offer / how we save".
 */
import type { ProfileRecord } from '@solidarity/shared';

import { useProfileSnapshotStore } from '@/people/profileSnapshots';
import { useProfileStore } from '@/profile/store';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import type {
  CardExchangeOffer,
  MergeKind,
  SaveIncoming,
} from './mutualExchange';

/** Our current signed FULL card as an exchange offer, or `null` if this device
 *  hasn't saved a profile yet (CLAUDE.md rule 8 — a decline, never a fabricated
 *  card). Pear is a mutually-authenticated private exchange, so it carries the
 *  full-scope record (all links, including private ones — T7's `scope: 'full'`,
 *  here left absent = full) rather than the public/shared projection the Nostr
 *  and QR paths use. */
export function buildOwnOffer(): CardExchangeOffer | null {
  const { record, jws } = useProfileStore.getState();
  if (!record || !jws) return null;
  return { card: jws, record };
}

/** Persist a verified incoming card via the Part-A merge policy, returning
 *  just the outcome kind for the exchange receipt. */
export function saveIncomingCard(record: ProfileRecord, jws: string): MergeKind {
  return useProfileSnapshotStore.getState().mergeVerified(record, jws).kind;
}

/**
 * Bind the save callback to the epoch in which an exchange starts. A lane
 * closed by a local wipe may still have a queued frame callback; that stale
 * callback must report failure and never resurrect the peer card afterward.
 */
export function createIncomingCardSaver(
  exchangeEpoch: LocalDataEpoch = captureLocalDataEpoch(),
): SaveIncoming {
  return (record, jws) => {
    if (!canCommitLocalData(exchangeEpoch)) return 'failed';
    return saveIncomingCard(record, jws);
  };
}
