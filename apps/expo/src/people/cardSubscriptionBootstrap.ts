/**
 * Card-wire subscription bootstrap — what happens to a verified
 * `subscription.nostr` pointer after the user SAVES a scanned card
 * (05-spec §3 v1.1; cards/nostrPointerClaim.ts holds the claim rules).
 *
 * v1 trust boundary (hardened 2026-08-25 after review): the pointer only
 * proves "the card SIGNER attests this npub". Nothing binds the card signing
 * key to any page's root did yet (the A5b cardKeyBinding JWS is session-
 * scoped: 300 s + aud + nonce, unusable in a static QR), so an attacker's
 * self-signed card can attest a THIRD PARTY's real npub. Two consequences
 * shaped this design:
 *
 *   1. NO NETWORK for an npub we don't already follow. The bootstrap first
 *      looks for a saved verified page whose OWN signed record already claims
 *      `nostr:<npub>`. If none exists, it returns `skippedNewDid` WITHOUT any
 *      relay dial — otherwise a hostile QR would turn every save into a
 *      relay round-trip for an attacker-chosen pubkey (read-receipt + IP
 *      disclosure). Discovering a NEW binding from an untrusted card stays an
 *      explicit act (scan their page / open their handle) until the v2
 *      root-signed card-key attestation lands (05 §3).
 *
 *   2. RELAY HINTS ARE NOT DIALLED in v1. The pointer's `relays` are
 *      attacker-controlled hosts; connecting to them is itself the attack
 *      (SSRF-adjacent, IP disclosure), and no emitter ships non-default
 *      hints today anyway. Resolution runs against `DEFAULT_RELAYS` only.
 *      The hint field is carried for forward-compat; a per-relay trust model
 *      is future work.
 *
 * When a matching saved page IS found, resolution runs the SAME verified
 * pipeline as the scanner (`resolveProfileByNpub`: JWS + reverse npub
 * binding) and the result is merged ONLY into the exact `(did, scope)` slot
 * that matched — so `mergeVerifiedSnapshot` always has that snapshot as its
 * freshness base (real T5 policy), never the unconditional-save branch that
 * a fresh slot would take. Fire-and-forget; every failure is silent.
 */
import type { NostrPointerClaim } from '@/cards/nostrPointerClaim';
import type {
  ProfileSnapshot,
  SnapshotMergeOutcome,
  VerifiedSnapshot,
} from '@/people/profileSnapshots';
import type { ProfileRecord, ProfileScope } from '@solidarity/shared';

export type BootstrapOutcome =
  | 'refreshed'
  | 'unchanged'
  | 'skippedNewDid'
  | 'mismatch'
  | 'invalid'
  | 'error';

export type BootstrapResolveResult =
  | { readonly kind: 'verified'; readonly record: ProfileRecord; readonly jws: string }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface BootstrapDeps {
  /** Resolve an npub against DEFAULT_RELAYS only (no attacker hints). */
  readonly resolveNpub?: (npub: string) => Promise<BootstrapResolveResult>;
  /** The saved verified snapshot whose record already claims `nostr:<npub>`,
   *  or undefined — the gate that keeps an unknown npub entirely offline. */
  readonly findSnapshotByNpub?: (npub: string) => VerifiedSnapshot | undefined;
  readonly mergeVerified?: (record: ProfileRecord, jws: string) => SnapshotMergeOutcome;
  readonly scopeOf?: (record: ProfileRecord) => ProfileScope;
}

export async function bootstrapCardSubscription(
  pointer: NostrPointerClaim,
  deps: BootstrapDeps = {}
): Promise<BootstrapOutcome> {
  try {
    const findSnapshotByNpub = deps.findSnapshotByNpub ?? (await defaultFindByNpub());

    // Gate BEFORE any network: only follow an npub we already trust via a
    // saved page. An unknown npub never triggers a relay dial.
    const existing = findSnapshotByNpub(pointer.npub);
    if (!existing) return 'skippedNewDid';

    const resolveNpub = deps.resolveNpub ?? (await defaultResolveNpub());
    const mergeVerified = deps.mergeVerified ?? (await defaultMerge());
    const scopeOf = deps.scopeOf ?? (await defaultScopeOf());

    const result = await resolveNpub(pointer.npub);
    if (result.kind !== 'verified') return 'invalid';
    // Refresh ONLY the exact slot that matched: same did AND same scope, so
    // the merge runs against the existing snapshot (T5 freshness), never
    // creating a new slot that could outrank and hide what the user holds.
    if (result.record.did !== existing.did || scopeOf(result.record) !== existing.scope) {
      return 'mismatch';
    }

    const outcome = mergeVerified(result.record, result.jws);
    return outcome.kind === 'saved' ? 'refreshed' : 'unchanged';
  } catch {
    return 'error';
  }
}

/** Fire-and-forget wrapper for the save path — never throws, never blocks. */
export function maybeBootstrapCardSubscription(pointer: NostrPointerClaim | undefined): void {
  if (!pointer) return;
  void bootstrapCardSubscription(pointer).catch(() => undefined);
}

/** Pure: the richest-scope saved verified snapshot whose signed record
 *  already claims `nostr:<npub>`. Exported for the default dep + tests. */
export function findVerifiedSnapshotByNpub(
  snapshots: Iterable<ProfileSnapshot>,
  npub: string,
  scopeRank: (scope: ProfileScope) => number
): VerifiedSnapshot | undefined {
  const claim = `nostr:${npub}`;
  let best: VerifiedSnapshot | undefined;
  for (const snapshot of snapshots) {
    if (snapshot.kind !== 'verified') continue;
    if (!snapshot.record.alsoKnownAs.includes(claim)) continue;
    if (!best || scopeRank(snapshot.scope) > scopeRank(best.scope)) best = snapshot;
  }
  return best;
}

// ─── Default (lazy) dependency implementations ─────────────────────────────

const SCOPE_RANK: Record<ProfileScope, number> = { full: 3, shared: 2, public: 1 };

async function defaultFindByNpub(): Promise<(npub: string) => VerifiedSnapshot | undefined> {
  const { useProfileSnapshotStore } = await import('@/people/profileSnapshots');
  return (npub) =>
    findVerifiedSnapshotByNpub(
      useProfileSnapshotStore.getState().snapshots.values(),
      npub,
      (scope) => SCOPE_RANK[scope]
    );
}

async function defaultResolveNpub(): Promise<(npub: string) => Promise<BootstrapResolveResult>> {
  const { resolveProfileByNpub } = await import('@/nostr/resolveProfile');
  return async (npub) => {
    // DEFAULT_RELAYS only — the pointer's relay hints are deliberately not
    // dialled in v1 (module doc, consequence 2).
    const result = await resolveProfileByNpub(npub);
    if (result.kind === 'verified') {
      return { kind: 'verified', record: result.record, jws: result.jws };
    }
    return { kind: 'invalid', reason: result.reason };
  };
}

async function defaultMerge(): Promise<
  (record: ProfileRecord, jws: string) => SnapshotMergeOutcome
> {
  const { useProfileSnapshotStore } = await import('@/people/profileSnapshots');
  return (record, jws) => useProfileSnapshotStore.getState().mergeVerified(record, jws);
}

async function defaultScopeOf(): Promise<(record: ProfileRecord) => ProfileScope> {
  const { scopeOf } = await import('@/people/profileSnapshots');
  return scopeOf;
}
