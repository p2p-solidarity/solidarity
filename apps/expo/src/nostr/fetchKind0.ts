/**
 * fetchKind0.ts — IO adapter bridging `dag/nostrAdapter.ts`'s raw relay
 * client to `@solidarity/shared`'s `badges/nostr.ts` `NostrKind0Fetcher`
 * shape (04-plan Phase A4 task A4.4, "wire the badge row to real
 * verification").
 *
 * Reuses `publish.ts`'s `fetchLatestKind0`/`parseKind0Content` verbatim
 * (same per-relay racing + timeout logic, same JSON-parse tolerance)
 * instead of re-implementing relay fan-out here — the badge verifier and
 * the kind-0 publisher must resolve "the newest kind-0 event" identically,
 * or a badge could flip states depending on which code path last touched
 * the relay set.
 *
 * `verifyNostrBinding` (packages/shared/src/badges/nostr.ts) treats a
 * `null` resolution as `stale` (a real "we couldn't confirm right now",
 * not a fabricated verdict — root CLAUDE.md rule 8) — this module never
 * synthesizes a kind-0 event when the relays don't answer.
 */
import { subscribeEvents } from '@/dag/nostrAdapter';
import type { NostrKind0Content, NostrKind0Fetcher } from '@solidarity/shared';

import { DEFAULT_FETCH_TIMEOUT_MS, fetchLatestKind0, parseKind0Content, type SubscribeEventsFn } from './publish';

export interface FetchKind0Options {
  readonly timeoutMs?: number;
  /** DI seam for tests — a mock relay instead of the real WS client. */
  readonly subscribeEventsFn?: SubscribeEventsFn;
}

/**
 * Resolve `pubkeyHex`'s newest kind-0 event across `relays`, JSON-parsing
 * its content into the `NostrKind0Content` shape `verifyNostrBinding`
 * expects. `null` when no relay answered before EOSE/error/timeout — the
 * caller (the badge verifier) maps this to `stale`, never to a fabricated
 * `verified`/`declared` verdict.
 */
export async function fetchKind0FromRelays(
  pubkeyHex: string,
  relays: readonly string[],
  opts: FetchKind0Options = {}
): Promise<NostrKind0Content | null> {
  const event = await fetchLatestKind0(
    relays,
    pubkeyHex,
    opts.subscribeEventsFn ?? subscribeEvents,
    opts.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  );
  if (!event) return null;
  return { contentJson: parseKind0Content(event.content), created_at: event.created_at };
}

/**
 * Curry a fixed relay list into a `NostrKind0Fetcher` — the exact shape
 * `verifyNostrBinding(profile, fetchKind0)` wants as its second argument.
 * Badge verification is a READ against public relay data, so it always
 * uses `DEFAULT_RELAYS` (or a caller-supplied list) directly — unlike
 * `publish.ts`'s functions, no user confirmation gate applies here (that
 * gate is specific to WRITING an event, per `publish.ts`'s `DEFAULT_RELAYS`
 * doc).
 */
export function makeKind0Fetcher(relays: readonly string[], opts?: FetchKind0Options): NostrKind0Fetcher {
  return (pubkeyHex) => fetchKind0FromRelays(pubkeyHex, relays, opts);
}
