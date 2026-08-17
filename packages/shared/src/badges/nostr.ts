/**
 * Nostr badge bidirectional-binding verifier — 04-plan Phase A4 task A4.3.
 * PURE module: no network, no WebSocket, no storage. IO is injected via
 * `NostrKind0Fetcher` so this file is consumed identically by apps/expo
 * and the future web viewer (05-plan V3 replays `verifyNostrBinding`
 * against `packages/shared/vectors/nostr-binding.json`, the app<->web
 * contract test).
 *
 * ── The two directions (see apps/expo/src/nostr/publish.ts's module doc
 *    for the full rationale of this exact shape) ─────────────────────────
 *
 *   Direction 1: `profile.alsoKnownAs` contains `nostr:npub1…` — the user
 *   is claiming "this Nostr identity is me".
 *   Direction 2: that npub's kind-0 (metadata) event has JSON content with
 *   `alsoKnownAs: string[]` containing `profile.did` — the Nostr identity
 *   is claiming back "this did:key is me".
 *
 * BOTH must hold for `verified` — this is 01-spec §7 / 03-spec §3's
 * single-direction-no-green-check rule, the entire point of this module.
 *
 * ── The state-mapping table (the honesty contract) ───────────────────────
 *
 * | Direction 1 (profile→npub)        | Direction 2 (kind-0→did)          | state      |
 * |------------------------------------|------------------------------------|------------|
 * | absent (no nostr:npub… claim)      | n/a — fetchKind0 never called      | `declared` (see "no-claim" note below) |
 * | present but malformed (bad bech32) | n/a — fetchKind0 never called      | `declared` |
 * | present, well-formed               | kind-0 fetch resolves `null`       | `stale`    |
 * | present, well-formed               | kind-0 fetched, does NOT contain did (missing field, or a DIFFERENT did:key) | `declared` |
 * | present, well-formed               | kind-0 fetched, DOES contain did   | `verified` |
 *
 * The `stale` vs `declared` boundary is the precise honesty distinction
 * this task exists to get right: `stale` means "we could not complete the
 * check right now" (network/relay failure — the binding might be fine,
 * we just don't know); `declared` means "we DID complete the check and it
 * came back one-way" (an affirmatively-observed non-reciprocation, or a
 * claim that was never even well-formed enough to check). A UI must never
 * show the same copy for both — `stale` implies "try again later",
 * `declared` implies "this claim is currently unconfirmed by its own
 * counter-claim".
 *
 * ── The "no claim at all" case ────────────────────────────────────────────
 *
 * `BadgeState` (01-spec §7) is a closed 4-value enum with no explicit
 * "not applicable" state. When `profile.alsoKnownAs` carries no
 * `nostr:npub…` entry at all, there is no Nostr binding to verify — this
 * is not-a-badge, not an unconfirmed one-way claim. The AUTHORITATIVE
 * signal for this case is the returned `npub: null` (also true for the
 * malformed-npub case), NOT `state`. Callers (the badge-list UI) MUST
 * gate whether to render a Nostr badge row on `npub !== null`, never on
 * `state` alone — `state: 'declared'` is populated only so the return
 * type stays non-nullable and is not itself meaningful when `npub` is
 * `null`. See `packages/shared/vectors/nostr-binding.json`'s
 * `no-npub-in-profile` case for the pinned expectation.
 */
import type { ProfileRecord } from '../profile';
import { npubToHex } from '../nostr/npub';
import type { Result } from '../types/result';
import type { BadgeState } from './types';

/** What the kind-0 (metadata) Nostr event looks like once fetched + JSON-parsed. */
export interface NostrKind0Content {
  readonly contentJson: unknown;
  readonly created_at: number;
}

/**
 * IO seam — the caller resolves the given pubkey's newest kind-0 event
 * (already JSON-parsed into `contentJson`) or `null` if it could not be
 * fetched (network/relay failure, no such event exists). Never expected
 * to throw, but `verifyNostrBinding` treats a thrown rejection identically
 * to a `null` resolution (see module doc's `stale` row) as a defensive
 * measure — the injected fetcher SHOULD still catch its own errors.
 */
export type NostrKind0Fetcher = (pubkeyHex: string) => Promise<NostrKind0Content | null>;

export interface NostrBindingEvidence {
  /** The raw `npub1…` string extracted from profile.alsoKnownAs, or null if no `nostr:npub…` entry exists at all. */
  readonly npubClaim: string | null;
  /** Hex-decoded pubkey, or null if `npubClaim` is absent or fails to decode. */
  readonly pubkeyHex: string | null;
  /** Direction 1: profile.alsoKnownAs carries a syntactically-valid nostr:npub… entry. */
  readonly direction1: boolean;
  /**
   * Direction 2: the fetched kind-0 event's `content.alsoKnownAs` contains
   * `profile.did`. `null` when kind-0 could not be fetched at all (or
   * Direction 1 never held, so it was never attempted) — distinct from
   * `false` (kind-0 WAS fetched but does not reciprocate).
   */
  readonly direction2: boolean | null;
  /** `created_at` (unix seconds) of the fetched kind-0 event, or null if none was fetched. */
  readonly kind0CreatedAt: number | null;
  /** One-line human-readable explanation, safe to render directly in an evidence panel. */
  readonly reason: string;
}

export interface VerifyNostrBindingResult {
  readonly state: BadgeState;
  /** The claimed npub (even if malformed), or null if profile makes no Nostr claim at all. */
  readonly npub: string | null;
  readonly evidence: NostrBindingEvidence;
}

const NOSTR_NPUB_AKA_PREFIX = 'nostr:npub';
const NOSTR_URI_PREFIX = 'nostr:';

/** First `nostr:npub…` entry in `profile.alsoKnownAs`, without the `nostr:` URI prefix, or null. */
function extractNpubClaim(profile: ProfileRecord): string | null {
  const entry = profile.alsoKnownAs.find((aka) => aka.startsWith(NOSTR_NPUB_AKA_PREFIX));
  return entry === undefined ? null : entry.slice(NOSTR_URI_PREFIX.length);
}

/** Does the kind-0 content's `alsoKnownAs: string[]` field contain `did`? */
function kind0ReciprocatesDid(contentJson: unknown, did: string): boolean {
  if (typeof contentJson !== 'object' || contentJson === null || Array.isArray(contentJson)) return false;
  const aka: unknown = (contentJson as Record<string, unknown>)['alsoKnownAs'];
  if (!Array.isArray(aka)) return false;
  return aka.some((v) => v === did);
}

function noClaimResult(): VerifyNostrBindingResult {
  return {
    state: 'declared',
    npub: null,
    evidence: {
      npubClaim: null,
      pubkeyHex: null,
      direction1: false,
      direction2: null,
      kind0CreatedAt: null,
      reason: 'profile.alsoKnownAs carries no nostr:npub… entry — no Nostr binding is claimed (not a badge)',
    },
  };
}

function malformedNpubResult(npubClaim: string, decodeError: string): VerifyNostrBindingResult {
  return {
    state: 'declared',
    npub: npubClaim,
    evidence: {
      npubClaim,
      pubkeyHex: null,
      direction1: false,
      direction2: null,
      kind0CreatedAt: null,
      reason: `malformed npub claim, cannot decode: ${decodeError}`,
    },
  };
}

/**
 * Resolve `pubkeyHex`'s kind-0 via `fetchKind0`, tolerating a thrown
 * rejection identically to a `null` resolution (see module doc).
 */
async function safeFetchKind0(fetchKind0: NostrKind0Fetcher, pubkeyHex: string): Promise<NostrKind0Content | null> {
  try {
    return await fetchKind0(pubkeyHex);
  } catch {
    return null;
  }
}

/**
 * Verify the bidirectional Nostr binding for `profile`. Pure aside from
 * the injected `fetchKind0` call — never throws. See module doc for the
 * full state-mapping table.
 */
export async function verifyNostrBinding(
  profile: ProfileRecord,
  fetchKind0: NostrKind0Fetcher
): Promise<VerifyNostrBindingResult> {
  const npubClaim = extractNpubClaim(profile);
  if (npubClaim === null) return noClaimResult();

  const pubkeyResult: Result<string, string> = npubToHex(npubClaim);
  if (!pubkeyResult.ok) return malformedNpubResult(npubClaim, pubkeyResult.error);
  const pubkeyHex = pubkeyResult.value;

  const kind0 = await safeFetchKind0(fetchKind0, pubkeyHex);

  if (kind0 === null) {
    return {
      state: 'stale',
      npub: npubClaim,
      evidence: {
        npubClaim,
        pubkeyHex,
        direction1: true,
        direction2: null,
        kind0CreatedAt: null,
        reason: 'kind-0 event unreachable right now — cannot confirm the reverse binding',
      },
    };
  }

  const direction2 = kind0ReciprocatesDid(kind0.contentJson, profile.did);
  return {
    state: direction2 ? 'verified' : 'declared',
    npub: npubClaim,
    evidence: {
      npubClaim,
      pubkeyHex,
      direction1: true,
      direction2,
      kind0CreatedAt: kind0.created_at,
      reason: direction2
        ? 'both directions confirmed: profile claims npub, kind-0 alsoKnownAs contains the did'
        : 'one-way only: profile claims npub, but kind-0 alsoKnownAs does not contain the did',
    },
  };
}
