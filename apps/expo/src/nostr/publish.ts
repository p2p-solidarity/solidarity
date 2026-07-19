/**
 * publish.ts — Nostr profile publish (NIP-78, kind 30078) + kind-0
 * `alsoKnownAs` did:key binding. 04-plan Phase A4 task A4.2.
 *
 * Reuses `dag/nostrAdapter.ts`'s raw WS client verbatim (`publishEvent` /
 * `subscribeEvents`) — no new WebSocket code here, only DI seams
 * (`publishEventFn`/`subscribeEventsFn` on the options objects) so tests
 * can inject a mock relay instead of hitting a real one. Signing goes
 * through `userKey.ts`'s `signNostrEvent` (production Nostr key,
 * provisioned once, no per-call Face-ID gate — see that module's doc: the
 * publish action itself is the user's consent, so nothing here may be
 * invoked from a background task).
 *
 * ── The two directions of the bidirectional binding (01-spec §5/§6) ─────
 *
 * `profile.alsoKnownAs` (packages/shared/src/profile.ts) gets a
 * `nostr:npub1…` entry — that's direction 1, built by the caller
 * (`profile/store.ts`'s `publishToNostr`, not this module) using
 * `userKey.ts`'s `npubEncode`. Direction 2 is `updateKind0AlsoKnownAs`
 * below: the user's kind-0 (metadata) event content gets an
 * `alsoKnownAs` array containing their `did:key:…`. A verifier
 * (`packages/shared/src/badges/nostr.ts`, task A4.3) only shows the
 * green check once BOTH directions resolve to each other.
 *
 * ── kind-0 binding convention: JSON `content.alsoKnownAs`, not a NIP-39
 *    `i` tag ──────────────────────────────────────────────────────────
 *
 * NIP-01 kind-0 content is an arbitrary JSON object (conventionally
 * `{name, about, picture, nip05, ...}` but not closed — unknown keys are
 * legal and every relay/client that doesn't understand a key just
 * ignores it, same as an unknown JSON field anywhere else). This module
 * adds a top-level `alsoKnownAs: string[]` key to that JSON, holding the
 * user's `did:key:…` — deliberately the SAME field name/shape as
 * `ProfileRecord.alsoKnownAs` (and the W3C DID Document `alsoKnownAs`
 * convention atproto's own DID document already uses), so a verifier
 * scans one field name on both sides of the binding.
 *
 * The alternative considered was a NIP-39 ("External Identities") `i`
 * tag, e.g. `["i", "did:did:key:z6Mk...", "<proof>"]`. Rejected because:
 *   1. NIP-39's defined claim types are platform HANDLES (github/
 *      twitter/mastodon/telegram/…), each with its own external-proof
 *      protocol (a signed gist, a tweet, …) — there is no standardized
 *      claim type for a bare DID, so any `i`-tag encoding here would be
 *      a private convention anyway, with none of NIP-39's actual
 *      interop benefit (no existing NIP-39-aware client would render or
 *      verify a `did:key` claim type).
 *   2. 01-spec-verified-page.md §5's badge table literally names the
 *      convention "kind-0 `alsoKnownAs`" (not "kind-0 `i` tag") — this
 *      is the documented, already-agreed-on shape; using a tag instead
 *      would silently diverge from the spec another task (A4.3) reads.
 *   3. A JSON content field is symmetric with `ProfileRecord.
 *      alsoKnownAs` — the verifier and any future debugging/reading code
 *      reuses one field name and one "is this DID in the array" check
 *      on both the profile side and the kind-0 side, instead of two
 *      different lookup shapes (array-of-strings vs. tag array indexing).
 */
import {
  publishEvent,
  subscribeEvents,
  type NostrEvent,
  type NostrFilter,
  type SubscriptionHandle,
} from '@/dag/nostrAdapter';

import {
  buildPublicDisclosureDTag,
  err,
  ok,
  type Result,
} from '@solidarity/shared';

import { getNostrPubkey, signNostrEvent, type UnsignedNostrEvent } from './userKey';

/** NIP-78 `d` tag identifying the profile-pointer event (01-spec §4). */
export const PROFILE_D_TAG = 'solidarity.profile';
/** NIP-78 parameterized-replaceable-event kind used for the profile pointer. */
export const KIND_PROFILE_POINTER = 30078;
/** NIP-01 metadata (kind-0) event kind. */
export const KIND_METADATA = 0;

/**
 * Well-known public relays, current as of this task (2026-07). Exposed so
 * a UI can show/edit them — publish.ts NEVER uses this constant silently:
 * every publish call takes an explicit `relays` list the caller (A4.4's
 * UI) is responsible for surfacing to the user for confirmation before
 * the FIRST publish. Re-publishes may reuse a previously-confirmed list
 * without re-prompting — that policy lives in the UI layer, not here.
 */
export const DEFAULT_RELAYS: readonly string[] = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  // relay.nostr.band replaced 2026-07-17: the whole nostr.band host was
  // unreachable (TCP timeout on every probe), so it always failed the
  // quorum AND stalled every publish/fetch for the full timeout.
  'wss://relay.primal.net',
];

export type PublishEventFn = typeof publishEvent;
export type SubscribeEventsFn = typeof subscribeEvents;

/** One relay's outcome for a publish attempt. */
export interface RelayPublishResult {
  readonly relay: string;
  readonly accepted: boolean;
  readonly message: string;
  readonly elapsedMs: number;
}

/**
 * Full publish outcome: the signed event that was sent, every relay's
 * individual result, and the aggregate `success` verdict. `success` is
 * ALWAYS present alongside the per-relay detail — a caller that only
 * reached quorum on 1 of 3 relays still gets the full report (which
 * relay(s) rejected, and why) rather than an opaque string error, so the
 * UI can show "published to nos.lol, failed on relay.damus.io: <reason>"
 * instead of just "publish failed".
 */
export interface PublishReport {
  readonly event: NostrEvent;
  readonly results: readonly RelayPublishResult[];
  readonly acceptedCount: number;
  readonly requiredCount: number;
  readonly success: boolean;
}

/**
 * Quorum rule: a strict majority of the relay set must accept — for the
 * spec's "≥3 relays, ≥2 must accept" default case this is exactly
 * `floor(3/2)+1 = 2`. Generalized as "more than half" so a caller-
 * confirmed relay list of a different size still gets a sane threshold
 * (4 relays -> need 3; 1 relay -> need 1).
 */
function requiredAcceptances(relayCount: number): number {
  return Math.floor(relayCount / 2) + 1;
}

/**
 * Retry budget for connection-level failures (`failure: 'transport'`): the
 * relay never gave a verdict, and measured flakiness (relay.damus.io behind
 * Cloudflare errors ~25% of first connects in ~350ms, succeeding on the
 * next attempt) means one failed dial must not count as a rejection.
 * Policy refusals (an OK frame with `accepted: false`) and timeouts (relay
 * down — another attempt just doubles the stall) are never retried.
 */
const TRANSPORT_RETRY_LIMIT = 2;
const TRANSPORT_RETRY_DELAY_MS = 300;

async function publishWithTransportRetry(
  relay: string,
  event: NostrEvent,
  publishFn: PublishEventFn,
  timeoutMs?: number
): Promise<RelayPublishResult> {
  let r = await publishFn(relay, event, timeoutMs);
  for (let retry = 0; retry < TRANSPORT_RETRY_LIMIT && r.failure === 'transport'; retry++) {
    await new Promise((resolve) => setTimeout(resolve, TRANSPORT_RETRY_DELAY_MS));
    r = await publishFn(relay, event, timeoutMs);
  }
  return { relay, accepted: r.accepted, message: r.message, elapsedMs: r.elapsedMs };
}

async function publishToRelays(
  event: NostrEvent,
  relays: readonly string[],
  publishFn: PublishEventFn,
  timeoutMs?: number
): Promise<PublishReport> {
  const results = await Promise.all(
    relays.map(async (relay) => publishWithTransportRetry(relay, event, publishFn, timeoutMs))
  );
  const acceptedCount = results.filter((r) => r.accepted).length;
  const requiredCount = requiredAcceptances(relays.length);
  return { event, results, acceptedCount, requiredCount, success: acceptedCount >= requiredCount };
}

// ── Direction 1: publish the profile pointer (kind 30078) ─────────────────

export interface PublishProfileOptions {
  /** The signed profile JWS string (from `profile/store.ts`'s `jws`). */
  readonly jws: string;
  /** Caller-confirmed relay list — see `DEFAULT_RELAYS`'s doc. Must be non-empty. */
  readonly relays: readonly string[];
  readonly timeoutMs?: number;
  /** Test-only: fixed timestamp instead of `Date.now()`. */
  readonly createdAt?: number;
  /** DI seam for tests — a mock relay instead of the real WS client. */
  readonly publishEventFn?: PublishEventFn;
}

interface PublishNip78Options {
  readonly jws: string;
  readonly relays: readonly string[];
  readonly timeoutMs?: number;
  readonly createdAt?: number;
  readonly publishEventFn?: PublishEventFn;
}

async function publishNip78Record(
  opts: PublishNip78Options,
  dTag: string,
  errorPrefix: string
): Promise<Result<PublishReport, string>> {
  if (opts.relays.length === 0) return err(`${errorPrefix}: relays list is empty`);

  const unsigned: UnsignedNostrEvent = {
    kind: KIND_PROFILE_POINTER,
    tags: [['d', dTag]],
    content: opts.jws,
    ...(opts.createdAt !== undefined ? { created_at: opts.createdAt } : {}),
  };
  const signed = await signNostrEvent(unsigned);
  if (!signed.ok) return err(signed.error);

  const report = await publishToRelays(
    signed.value,
    opts.relays,
    opts.publishEventFn ?? publishEvent,
    opts.timeoutMs
  );
  return ok(report);
}

/**
 * Build + sign a NIP-78 kind-30078 event (`tags: [['d', 'solidarity.
 * profile']]`, `content` = the profile JWS verbatim) and publish it to
 * every relay in `opts.relays`. Never uses `DEFAULT_RELAYS` implicitly —
 * see that constant's doc.
 */
export async function publishProfile(opts: PublishProfileOptions): Promise<Result<PublishReport, string>> {
  return publishNip78Record(opts, PROFILE_D_TAG, 'publishProfile');
}

export interface PublishPublicDisclosureOptions extends PublishNip78Options {
  /** Opaque slot mirrored inside the root-signed disclosure record. */
  readonly slot: string;
}

/** Publish one presence-only disclosure to its own parameterized NIP-78 slot. */
export async function publishPublicDisclosure(
  opts: PublishPublicDisclosureOptions
): Promise<Result<PublishReport, string>> {
  const dTag = buildPublicDisclosureDTag(opts.slot);
  if (!dTag.ok) return err(`publishPublicDisclosure: ${dTag.error.detail}`);
  return publishNip78Record(opts, dTag.value, 'publishPublicDisclosure');
}

// ── Direction 2: merge did:key into kind-0 `alsoKnownAs` ──────────────────

/**
 * Exported (not just used internally) so `fetchKind0.ts` (task A4.4's
 * verifier-side IO adapter) shares the exact same default wait budget and
 * JSON-parsing tolerance as the publish-side fetch below — the verifier and
 * the publisher must agree on what "the newest kind-0" means.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 4000;

export function parseKind0Content(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Outcome of a kind-0 fetch across a relay set.
 *
 * `confirmed` distinguishes the two very different meanings of
 * `event === null`, which callers MUST NOT conflate:
 *   - `confirmed: true`  → at least one relay answered authoritatively
 *     (EOSE) with no matching event: the pubkey genuinely has no kind-0.
 *   - `confirmed: false` → every relay errored or timed out before EOSE
 *     and none delivered an event: we are BLIND. A writer must not treat
 *     this as "no existing content" — doing so overwrites (wipes) whatever
 *     kind-0 the user actually has. See `updateKind0AlsoKnownAs`.
 * (The badge verifier only needs `event` today; `confirmed` is also the
 * hook to later separate `stale` from `declared` — 04-plan A4.3 honesty
 * table — but that's not wired here yet.)
 * ponytail: `confirmed` exists solely to gate the clobber-guard below.
 */
export interface Kind0FetchResult {
  readonly event: NostrEvent | null;
  readonly confirmed: boolean;
}

/**
 * Query every relay in `relays` for the newest event (by `created_at`)
 * matching `filter`, returning it plus whether any relay gave a definitive
 * EOSE (see `Kind0FetchResult`). Each relay gets its own bounded wait — one
 * slow/dead relay never blocks the others (`Promise.all` over independent
 * per-relay promises, each with its own timeout fallback).
 *
 * The shared per-relay racing core: `fetchLatestKind0` (badge verification)
 * and `fetchLatestProfilePointer` (the `#nostr:` short-pointer resolver)
 * both delegate here so every path resolves "the newest matching event"
 * identically instead of re-implementing the WS fan-out.
 */
export async function fetchLatestEvent(
  relays: readonly string[],
  filter: NostrFilter,
  subscribeFn: SubscribeEventsFn,
  timeoutMs: number
): Promise<Kind0FetchResult> {
  if (relays.length === 0) return { event: null, confirmed: false };

  const perRelay = relays.map(
    (relay) =>
      new Promise<Kind0FetchResult>((resolve) => {
        let latest: NostrEvent | null = null;
        let sawEose = false;
        let settled = false;
        // Mutable box (rather than a reassigned `let`) so `finish` can
        // close the subscription even if `subscribeFn` invokes one of its
        // callbacks synchronously, before its own return value would
        // otherwise have been assigned.
        const box: { handle?: SubscriptionHandle } = {};
        const finish = (): void => {
          if (settled) return;
          settled = true;
          try {
            box.handle?.close();
          } catch {
            // already closed
          }
          resolve({ event: latest, confirmed: sawEose });
        };
        const timer = setTimeout(finish, timeoutMs); // timed out → not confirmed
        box.handle = subscribeFn(
          relay,
          filter,
          (event) => {
            if (!latest || event.created_at > latest.created_at) latest = event;
          },
          () => {
            // EOSE — this relay authoritatively delivered its whole result set.
            sawEose = true;
            clearTimeout(timer);
            finish();
          },
          () => {
            // error/notice/close before EOSE — this relay's answer is unknown.
            clearTimeout(timer);
            finish();
          }
        );
      })
  );

  const perRelayResults = await Promise.all(perRelay);
  let best: NostrEvent | null = null;
  let confirmed = false;
  for (const candidate of perRelayResults) {
    if (candidate.confirmed) confirmed = true;
    if (candidate.event && (!best || candidate.event.created_at > best.created_at)) best = candidate.event;
  }
  return { event: best, confirmed };
}

/**
 * The user's newest kind-0 (metadata) event. Thin wrapper over
 * `fetchLatestEvent` — reused by `fetchKind0.ts`'s badge-verifier IO adapter
 * and by `updateKind0AlsoKnownAs` below.
 */
export async function fetchLatestKind0(
  relays: readonly string[],
  pubkeyHex: string,
  subscribeFn: SubscribeEventsFn,
  timeoutMs: number
): Promise<Kind0FetchResult> {
  return fetchLatestEvent(relays, { kinds: [KIND_METADATA], authors: [pubkeyHex], limit: 1 }, subscribeFn, timeoutMs);
}

/**
 * The user's newest kind-30078 profile-pointer event (NIP-78,
 * `#d=solidarity.profile`), whose `content` is their profile JWS. This is
 * the discovery half of the `#nostr:<npub>` short-pointer share URL:
 * `resolveProfile.ts` decodes the npub to `pubkeyHex`, fetches this event,
 * then verifies the embedded JWS signature AND the reverse `alsoKnownAs`
 * binding (so a relay can't substitute someone else's validly-signed
 * profile for the npub the sharer pointed at).
 */
export async function fetchLatestProfilePointer(
  relays: readonly string[],
  pubkeyHex: string,
  subscribeFn: SubscribeEventsFn,
  timeoutMs: number
): Promise<Kind0FetchResult> {
  return fetchLatestEvent(
    relays,
    { kinds: [KIND_PROFILE_POINTER], authors: [pubkeyHex], '#d': [PROFILE_D_TAG], limit: 1 },
    subscribeFn,
    timeoutMs
  );
}

export interface UpdateKind0Options {
  /** The user's did:key (e.g. `ProfileRecord.did`) to bind into kind-0. */
  readonly did: string;
  /** Caller-confirmed relay list, used both to fetch the existing kind-0 and to republish it. Must be non-empty. */
  readonly relays: readonly string[];
  readonly timeoutMs?: number;
  /** Wait budget per relay when fetching the existing kind-0 (default 4000ms). */
  readonly fetchTimeoutMs?: number;
  /** Test-only: fixed timestamp instead of `Date.now()`. */
  readonly createdAt?: number;
  /** DI seam for tests — a mock relay instead of the real WS client. */
  readonly publishEventFn?: PublishEventFn;
  /** DI seam for tests — a mock relay instead of the real WS client. */
  readonly subscribeEventsFn?: SubscribeEventsFn;
}

/**
 * Fetch the user's current kind-0 (if any), merge `opts.did` into its
 * `alsoKnownAs` array (preserving every other existing field/entry
 * verbatim — `name`/`about`/`picture`/prior `alsoKnownAs` entries all
 * survive), re-sign, and republish to `opts.relays`. Idempotent: running
 * this again with the same `did` is a no-op content-wise (the set
 * de-dupes) but still produces a fresh signed event (new `created_at`)
 * unless `opts.createdAt` is pinned.
 */
export async function updateKind0AlsoKnownAs(opts: UpdateKind0Options): Promise<Result<PublishReport, string>> {
  if (opts.relays.length === 0) return err('updateKind0AlsoKnownAs: relays list is empty');

  const pubkeyResult = await getNostrPubkey();
  if (!pubkeyResult.ok) return err(pubkeyResult.error);

  const subscribeFn = opts.subscribeEventsFn ?? subscribeEvents;
  const existing = await fetchLatestKind0(
    opts.relays,
    pubkeyResult.value,
    subscribeFn,
    opts.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
  );
  // Blind read: no event AND no relay reached EOSE (all errored/timed out).
  // We don't know whether a kind-0 with name/about/picture already exists, so
  // publishing a fresh {alsoKnownAs:[did]} would overwrite it. Abort instead
  // of clobbering. (Only proceed with an empty base when a relay authoritatively
  // confirmed there is no existing kind-0.)
  if (existing.event === null && !existing.confirmed) {
    return err(
      'updateKind0AlsoKnownAs: could not read your existing Nostr profile from any relay (all unreachable or timed out) — not publishing, as it could overwrite your current profile metadata. Check your connection and retry.'
    );
  }
  const baseContent = existing.event ? parseKind0Content(existing.event.content) : {};

  const existingAka = Array.isArray(baseContent['alsoKnownAs'])
    ? baseContent['alsoKnownAs'].filter((v): v is string => typeof v === 'string')
    : [];
  const akaSet = new Set(existingAka);
  akaSet.add(opts.did);
  const mergedContent: Record<string, unknown> = { ...baseContent, alsoKnownAs: [...akaSet] };

  const unsigned: UnsignedNostrEvent = {
    kind: KIND_METADATA,
    tags: [],
    content: JSON.stringify(mergedContent),
    ...(opts.createdAt !== undefined ? { created_at: opts.createdAt } : {}),
  };
  const signed = await signNostrEvent(unsigned);
  if (!signed.ok) return err(signed.error);

  const report = await publishToRelays(signed.value, opts.relays, opts.publishEventFn ?? publishEvent, opts.timeoutMs);
  return ok(report);
}
