/**
 * Contact auto-update — the CREDS §3.3 「訂閱憑據」 lane, v1
 * (docs/ref/05-spec-qr-exchange.md §3; ruling 2026-08-25: Pear lane stays
 * the private-exchange channel, NIP-44 is an optional later lane; THIS lane
 * is the public-HEAD refresh).
 *
 * A saved VerifiedSnapshot whose signed record claims `nostr:<npub>` in
 * `alsoKnownAs` already carries its own subscription credential: the npub
 * names the publisher key whose NIP-78 HEAD (kind 30078,
 * `d=solidarity.profile`) holds the newest signed page. On app foreground
 * (throttled to one sweep per `AUTO_REFRESH_MIN_INTERVAL_MS`) each such did
 * is re-resolved through the SAME pipeline the scanner uses
 * (`resolveProfileByNpub`: JWS verify + reverse npub-binding gate) and merged
 * through the SAME freshness policy (`mergeVerified`), which feeds the
 * Contacts 「最近更新」 section only on a real, newer change.
 *
 * Honesty rules:
 *   - Device-side only: no server, no push (mock F8's v1 honesty line —
 *     notifications are generated on-device when the app is open).
 *   - A background sweep must never CREATE a person: the resolved record's
 *     did must equal the stored did, or the result is dropped. Without this,
 *     the npub's key holder (by publishing someone else's validly-signed
 *     record that claims the npub back) could make a silent sweep save a
 *     different identity into People.
 *   - Failures are silent and per-contact (offline is a normal state); an
 *     unreachable relay never marks the stored snapshot stale.
 */
import type { ProfileSnapshot } from '@/people/profileSnapshots';
import type { SnapshotMergeOutcome } from '@/people/profileSnapshots';
import type { ProfileRecord } from '@solidarity/shared';

/** One sweep per 6 h — contact freshness matters, relay traffic is not free.
 *  The badge-check cadence (24 h) is a different, per-badge cycle. */
export const AUTO_REFRESH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Hard cap per sweep — matches the recent-updates feed's own 30-event cap. */
export const AUTO_REFRESH_MAX_CONTACTS = 30;
const LAST_SWEEP_KEY = 'contacts:auto-refresh:last-sweep:v1';

/** Same cheap shape gate the scanner/deep-link classifiers use. */
const NPUB_RE = /^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/u;
const MAX_NPUB_LENGTH = 90;

export interface AutoRefreshCandidate {
  readonly did: string;
  readonly npub: string;
}

/**
 * Pure candidate extraction: every verified snapshot whose signed record
 * claims a well-formed `nostr:<npub>`, deduped by did (a did stored under
 * several projection scopes still refreshes once). Declared snapshots have
 * no did and no signature — never candidates.
 */
export function collectAutoRefreshCandidates(
  snapshots: Iterable<ProfileSnapshot>
): readonly AutoRefreshCandidate[] {
  const byDid = new Map<string, string>();
  for (const snapshot of snapshots) {
    if (snapshot.kind !== 'verified') continue;
    if (byDid.has(snapshot.did)) continue;
    for (const claim of snapshot.record.alsoKnownAs) {
      if (!claim.startsWith('nostr:')) continue;
      const npub = claim.slice('nostr:'.length);
      if (NPUB_RE.test(npub) && npub.length <= MAX_NPUB_LENGTH) {
        byDid.set(snapshot.did, npub);
        break;
      }
    }
  }
  return [...byDid.entries()].map(([did, npub]) => ({ did, npub }));
}

/** The subset of `VerifiedPageResult` this lane consumes (DI seam). */
export type AutoRefreshResolveResult =
  | { readonly kind: 'verified'; readonly record: ProfileRecord; readonly jws: string }
  | { readonly kind: 'invalid'; readonly reason: string; readonly detail?: string };

export interface AutoRefreshDeps {
  readonly now?: () => number;
  readonly getLastSweepAt?: () => number | null | Promise<number | null>;
  readonly setLastSweepAt?: (epochMs: number) => void | Promise<void>;
  readonly loadSnapshots?: () => Promise<Iterable<ProfileSnapshot>>;
  readonly resolveNpub?: (npub: string) => Promise<AutoRefreshResolveResult>;
  readonly mergeVerified?: (record: ProfileRecord, jws: string) => SnapshotMergeOutcome;
  readonly minIntervalMs?: number;
  readonly maxContacts?: number;
}

export interface AutoRefreshSummary {
  readonly ran: boolean;
  readonly reason?: 'throttled' | 'empty';
  /** Candidates actually resolved this sweep (≤ maxContacts). */
  readonly checked: number;
  /** Merges that produced a strictly-newer stored record. */
  readonly saved: number;
  /** alreadyCurrent / keptNewer / conflict outcomes — nothing user-visible. */
  readonly unchanged: number;
  /** Verified results whose did did not match the stored did — discarded. */
  readonly dropped: number;
  /** invalid / unreachable / thrown — silent, per-contact. */
  readonly failed: number;
}

/**
 * One throttled sweep. Every dependency is injectable for tests; every
 * default lazy-imports its real module (the Nostr chain pulls
 * `expo-secure-store`, which Bun's test loader cannot parse at import time).
 */
export async function refreshVerifiedContactsOnce(
  deps: AutoRefreshDeps = {}
): Promise<AutoRefreshSummary> {
  const now = deps.now ?? Date.now;
  const minInterval = deps.minIntervalMs ?? AUTO_REFRESH_MIN_INTERVAL_MS;
  const maxContacts = deps.maxContacts ?? AUTO_REFRESH_MAX_CONTACTS;
  const nowMs = now();

  const getLastSweepAt = deps.getLastSweepAt ?? defaultGetLastSweepAt;
  const setLastSweepAt = deps.setLastSweepAt ?? defaultSetLastSweepAt;
  const lastSweep = await maybeAsync(getLastSweepAt);
  if (lastSweep !== null && nowMs - lastSweep < minInterval) {
    return { ran: false, reason: 'throttled', checked: 0, saved: 0, unchanged: 0, dropped: 0, failed: 0 };
  }

  const loadSnapshots = deps.loadSnapshots ?? defaultLoadSnapshots;
  const candidates = collectAutoRefreshCandidates(await loadSnapshots()).slice(0, maxContacts);
  if (candidates.length === 0) {
    return { ran: false, reason: 'empty', checked: 0, saved: 0, unchanged: 0, dropped: 0, failed: 0 };
  }

  // Stamp BEFORE the network loop: a sweep that dies mid-way must not retry
  // on the very next foreground (relay hammering), and the next successful
  // interval will catch anything missed.
  await Promise.resolve(setLastSweepAt(nowMs));

  const resolveNpub = deps.resolveNpub ?? (await defaultResolveNpub());
  const mergeVerified = deps.mergeVerified ?? (await defaultMergeVerified());

  let saved = 0;
  let unchanged = 0;
  let dropped = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await resolveNpub(candidate.npub);
      if (result.kind !== 'verified') {
        failed += 1;
        continue;
      }
      if (result.record.did !== candidate.did) {
        // Never let a sweep admit a different identity — see module doc.
        dropped += 1;
        continue;
      }
      const outcome = mergeVerified(result.record, result.jws);
      if (outcome.kind === 'saved') saved += 1;
      else unchanged += 1;
    } catch {
      failed += 1;
    }
  }

  return { ran: true, checked: candidates.length, saved, unchanged, dropped, failed };
}

/**
 * Fire-and-forget wrapper for the root layout's foreground hook — never
 * throws, never surfaces anything. The sweep's only user-visible output is
 * a genuine entry in Contacts 「最近更新」.
 */
export function maybeRefreshVerifiedContacts(): void {
  void refreshVerifiedContactsOnce().catch(() => undefined);
}

// ─── Default (lazy) dependency implementations ─────────────────────────────

async function maybeAsync<T>(fn: () => T | Promise<T>): Promise<T> {
  return fn();
}

async function defaultGetLastSweepAt(): Promise<number | null> {
  try {
    const { getMmkv } = await import('@/storage/mmkv');
    const raw = getMmkv().getString(LAST_SWEEP_KEY);
    const parsed = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Storage not ready — treated as "no previous sweep".
    return null;
  }
}

async function defaultSetLastSweepAt(epochMs: number): Promise<void> {
  try {
    const { getMmkv } = await import('@/storage/mmkv');
    getMmkv().set(LAST_SWEEP_KEY, String(epochMs));
  } catch {
    // Storage not ready — the next sweep simply won't be throttled.
  }
}

async function defaultLoadSnapshots(): Promise<Iterable<ProfileSnapshot>> {
  const { useProfileSnapshotStore } = await import('@/people/profileSnapshots');
  return useProfileSnapshotStore.getState().snapshots.values();
}

async function defaultResolveNpub(): Promise<(npub: string) => Promise<AutoRefreshResolveResult>> {
  const { resolveProfileByNpub } = await import('@/nostr/resolveProfile');
  return async (npub: string) => {
    const result = await resolveProfileByNpub(npub);
    if (result.kind === 'verified') {
      return { kind: 'verified', record: result.record, jws: result.jws };
    }
    return { kind: 'invalid', reason: result.reason, detail: result.detail };
  };
}

async function defaultMergeVerified(): Promise<(record: ProfileRecord, jws: string) => SnapshotMergeOutcome> {
  const { useProfileSnapshotStore } = await import('@/people/profileSnapshots');
  return (record, jws) => useProfileSnapshotStore.getState().mergeVerified(record, jws);
}
