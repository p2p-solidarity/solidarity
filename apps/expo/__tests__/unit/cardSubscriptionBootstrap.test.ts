/**
 * Card-wire subscription bootstrap (05-spec §3 v1.1) + the pointer-claim
 * validators. Pins the hardened v1 trust boundary:
 *   - NO network for an npub the user doesn't already follow (offline gate);
 *   - relay HINTS are never dialled (resolution is DEFAULT_RELAYS only);
 *   - refresh only the exact (did, scope) slot that matched — never a new
 *     slot that could outrank and hide what the user holds.
 */
import { describe, expect, it } from 'bun:test';

import {
  parseNostrPointerClaim,
  sanitizeRelayHints,
} from '../../src/cards/nostrPointerClaim';
import {
  bootstrapCardSubscription,
  findVerifiedSnapshotByNpub,
  type BootstrapResolveResult,
} from '../../src/people/cardSubscriptionBootstrap';
import type { ProfileSnapshot, VerifiedSnapshot } from '../../src/people/profileSnapshots';
import type { ProfileRecord, ProfileScope } from '@solidarity/shared';

const NPUB = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql6verd';
const SCOPE_RANK: Record<ProfileScope, number> = { full: 3, shared: 2, public: 1 };

function record(did: string, scope: ProfileScope | undefined, updatedAt = '2026-08-24T00:00:00Z'): ProfileRecord {
  return {
    did,
    displayName: 'Ada',
    bio: '',
    links: [],
    alsoKnownAs: [`nostr:${NPUB}`],
    updatedAt,
    ...(scope ? { scope } : {}),
  } as unknown as ProfileRecord;
}

function snapshot(did: string, scope: ProfileScope, claimsNpub = true): VerifiedSnapshot {
  return {
    kind: 'verified',
    did,
    scope,
    record: {
      did,
      displayName: 'Ada',
      bio: '',
      links: [],
      alsoKnownAs: claimsNpub ? [`nostr:${NPUB}`] : [],
      updatedAt: '2026-08-20T00:00:00Z',
    },
    jws: 'h.p.s',
    verifiedAt: '2026-08-21T00:00:00Z',
    note: null,
    conflicts: [],
  } as unknown as VerifiedSnapshot;
}

describe('sanitizeRelayHints', () => {
  it('keeps only well-formed wss URLs, deduped and capped at 3', () => {
    expect(
      sanitizeRelayHints([
        'wss://relay.damus.io',
        'wss://relay.damus.io',
        'https://not-wss.example',
        'ftp://nope',
        42,
        `wss://${'x'.repeat(70)}.example`,
        'wss://nos.lol',
        'wss://relay.primal.net',
        'wss://one-too-many.example',
      ])
    ).toEqual(['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net']);
    expect(sanitizeRelayHints('wss://not-an-array')).toEqual([]);
    expect(sanitizeRelayHints(undefined)).toEqual([]);
  });
});

describe('parseNostrPointerClaim', () => {
  it('extracts a valid pointer and rejects malformed npubs', () => {
    const claims = {
      vc: { credentialSubject: { subscription: { nostr: { npub: NPUB, relays: ['wss://nos.lol'] } } } },
    };
    expect(parseNostrPointerClaim(claims)).toEqual({ npub: NPUB, relays: ['wss://nos.lol'] });
    expect(
      parseNostrPointerClaim({
        vc: { credentialSubject: { subscription: { nostr: { npub: 'npub1BAD', relays: [] } } } },
      })
    ).toBeNull();
    expect(parseNostrPointerClaim({ vc: {} })).toBeNull();
    expect(parseNostrPointerClaim({})).toBeNull();
  });
});

describe('findVerifiedSnapshotByNpub', () => {
  it('finds the richest-scope snapshot claiming the npub; ignores declared and non-claiming', () => {
    const snaps: ProfileSnapshot[] = [
      snapshot('did:key:zAda', 'public'),
      snapshot('did:key:zAda', 'full'),
      snapshot('did:key:zBob', 'full', false), // does not claim the npub
      { kind: 'declared', id: 'x', did: null, sourceUrl: 'https://l.ee/x', title: null, links: [], importedAt: '2026-08-21T00:00:00Z' } as unknown as ProfileSnapshot,
    ];
    const found = findVerifiedSnapshotByNpub(snaps, NPUB, (s) => SCOPE_RANK[s]);
    expect(found?.did).toBe('did:key:zAda');
    expect(found?.scope).toBe('full');
    expect(findVerifiedSnapshotByNpub([], NPUB, (s) => SCOPE_RANK[s])).toBeUndefined();
  });
});

interface Harness {
  readonly resolved: string[];
  readonly merged: string[];
}

function deps(
  harness: Harness,
  matched: VerifiedSnapshot | undefined,
  result: BootstrapResolveResult
) {
  return {
    findSnapshotByNpub: () => matched,
    resolveNpub: async (npub: string) => {
      harness.resolved.push(npub);
      return result;
    },
    mergeVerified: (rec: ProfileRecord) => {
      harness.merged.push(rec.did);
      return { kind: 'saved' as const, snapshot: {} as never };
    },
    scopeOf: (rec: ProfileRecord) =>
      ((rec as unknown as { scope?: ProfileScope }).scope ?? 'full'),
  };
}

describe('bootstrapCardSubscription', () => {
  it('does NOTHING and never dials a relay for an npub we do not already follow', async () => {
    const harness: Harness = { resolved: [], merged: [] };
    const outcome = await bootstrapCardSubscription(
      { npub: NPUB, relays: ['wss://attacker.example'] },
      deps(harness, undefined, { kind: 'verified', record: record('did:key:zAny', 'public'), jws: 'h.p.s' })
    );
    expect(outcome).toBe('skippedNewDid');
    expect(harness.resolved).toEqual([]); // no network at all
    expect(harness.merged).toEqual([]);
  });

  it('refreshes the exact matched slot when did AND scope agree', async () => {
    const harness: Harness = { resolved: [], merged: [] };
    const matched = snapshot('did:key:zAda', 'public');
    const outcome = await bootstrapCardSubscription(
      { npub: NPUB, relays: [] },
      deps(harness, matched, { kind: 'verified', record: record('did:key:zAda', 'public', '2026-08-25T00:00:00Z'), jws: 'h.p.s2' })
    );
    expect(outcome).toBe('refreshed');
    expect(harness.resolved).toEqual([NPUB]);
    expect(harness.merged).toEqual(['did:key:zAda']);
  });

  it('refuses to merge when the resolved SCOPE differs from the matched slot (no new slot)', async () => {
    const harness: Harness = { resolved: [], merged: [] };
    const matched = snapshot('did:key:zAda', 'public');
    // Attacker card points at Ada's real npub; resolver returns a scope-less
    // (legacy = full) record. A 'full' slot must NOT be created next to the
    // held 'public' one (it would outrank and hide it with no freshness check).
    const outcome = await bootstrapCardSubscription(
      { npub: NPUB, relays: [] },
      deps(harness, matched, { kind: 'verified', record: record('did:key:zAda', undefined), jws: 'h.p.s3' })
    );
    expect(outcome).toBe('mismatch');
    expect(harness.merged).toEqual([]);
  });

  it('refuses to merge when the resolved DID differs from the matched slot', async () => {
    const harness: Harness = { resolved: [], merged: [] };
    const matched = snapshot('did:key:zAda', 'public');
    const outcome = await bootstrapCardSubscription(
      { npub: NPUB, relays: [] },
      deps(harness, matched, { kind: 'verified', record: record('did:key:zEve', 'public'), jws: 'h.p.s4' })
    );
    expect(outcome).toBe('mismatch');
    expect(harness.merged).toEqual([]);
  });

  it('treats unresolved/invalid results as silent no-ops', async () => {
    const harness: Harness = { resolved: [], merged: [] };
    const matched = snapshot('did:key:zAda', 'public');
    const outcome = await bootstrapCardSubscription(
      { npub: NPUB, relays: [] },
      deps(harness, matched, { kind: 'invalid', reason: 'unreachable' })
    );
    expect(outcome).toBe('invalid');
    expect(harness.merged).toEqual([]);
  });
});
