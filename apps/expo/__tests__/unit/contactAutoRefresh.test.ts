/**
 * Contact auto-update lane (CREDS §3.3 v1, 05-spec §3) — every dependency is
 * injected, so this suite runs with zero MMKV/Nostr/native surface. Pins the
 * three properties the module doc promises:
 *   - only npub-claiming VERIFIED snapshots become candidates (deduped by did)
 *   - the sweep is throttled and stamps BEFORE the network loop
 *   - a resolved record whose did differs from the stored did is dropped,
 *     never merged (a sweep must not create or swap a person)
 */
import { describe, expect, it } from 'bun:test';

import {
  collectAutoRefreshCandidates,
  refreshVerifiedContactsOnce,
  type AutoRefreshResolveResult,
} from '../../src/people/contactAutoRefresh';
import type { ProfileSnapshot } from '../../src/people/profileSnapshots';
import type { ProfileRecord } from '@solidarity/shared';

const NPUB_A = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqql6verd';
const NPUB_B = 'npub1wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwe5rvpd';

function record(did: string, alsoKnownAs: readonly string[], updatedAt = '2026-08-20T00:00:00Z'): ProfileRecord {
  return {
    did,
    displayName: `Person ${did.slice(-4)}`,
    bio: '',
    links: [],
    alsoKnownAs,
    updatedAt,
  } as unknown as ProfileRecord;
}

function verified(did: string, alsoKnownAs: readonly string[]): ProfileSnapshot {
  return {
    kind: 'verified',
    did,
    scope: 'full',
    record: record(did, alsoKnownAs),
    jws: 'header.payload.sig',
    verifiedAt: '2026-08-21T00:00:00Z',
    note: null,
    conflicts: [],
  } as unknown as ProfileSnapshot;
}

describe('collectAutoRefreshCandidates', () => {
  it('collects only verified snapshots with a well-formed nostr claim, deduped by did', () => {
    const snapshots: ProfileSnapshot[] = [
      verified('did:key:zAlice', [`nostr:${NPUB_A}`, 'at://alice.bsky.social']),
      // Same did stored under another projection — must not duplicate.
      verified('did:key:zAlice', [`nostr:${NPUB_A}`]),
      verified('did:key:zBob', ['at://bob.bsky.social']), // no nostr claim
      verified('did:key:zMallory', ['nostr:not-an-npub']), // malformed claim
      {
        kind: 'declared',
        id: 'abc123',
        did: null,
        sourceUrl: 'https://linktr.ee/x',
        title: null,
        links: [],
        importedAt: '2026-08-21T00:00:00Z',
      } as unknown as ProfileSnapshot,
    ];
    expect(collectAutoRefreshCandidates(snapshots)).toEqual([
      { did: 'did:key:zAlice', npub: NPUB_A },
    ]);
  });
});

interface Harness {
  readonly resolved: string[];
  readonly merged: { did: string }[];
  readonly stamps: number[];
  lastSweepAt: number | null;
}

function makeDeps(
  harness: Harness,
  snapshots: readonly ProfileSnapshot[],
  resolve: (npub: string) => AutoRefreshResolveResult,
  now = 1_000_000_000
) {
  return {
    now: () => now,
    getLastSweepAt: () => harness.lastSweepAt,
    setLastSweepAt: (ms: number) => {
      harness.stamps.push(ms);
      harness.lastSweepAt = ms;
    },
    loadSnapshots: async () => snapshots,
    resolveNpub: async (npub: string) => {
      harness.resolved.push(npub);
      return resolve(npub);
    },
    mergeVerified: (rec: ProfileRecord) => {
      harness.merged.push({ did: rec.did });
      return {
        kind: 'saved' as const,
        snapshot: verified(rec.did, rec.alsoKnownAs) as never,
      };
    },
  };
}

function freshHarness(lastSweepAt: number | null = null): Harness {
  return { resolved: [], merged: [], stamps: [], lastSweepAt };
}

describe('refreshVerifiedContactsOnce', () => {
  const aliceSnapshots = [verified('did:key:zAlice', [`nostr:${NPUB_A}`])];

  it('resolves, merges, and stamps before the network loop on a due sweep', async () => {
    const harness = freshHarness();
    const deps = makeDeps(harness, aliceSnapshots, () => ({
      kind: 'verified',
      record: record('did:key:zAlice', [`nostr:${NPUB_A}`], '2026-08-24T00:00:00Z'),
      jws: 'h.p.s2',
    }));
    const summary = await refreshVerifiedContactsOnce(deps);
    expect(summary).toEqual({ ran: true, checked: 1, saved: 1, unchanged: 0, dropped: 0, failed: 0 });
    expect(harness.resolved).toEqual([NPUB_A]);
    expect(harness.merged).toEqual([{ did: 'did:key:zAlice' }]);
    expect(harness.stamps).toEqual([1_000_000_000]);
  });

  it('is throttled inside the interval and does not touch the network', async () => {
    const harness = freshHarness(1_000_000_000 - 1000);
    const deps = makeDeps(harness, aliceSnapshots, () => {
      throw new Error('must not resolve while throttled');
    });
    const summary = await refreshVerifiedContactsOnce(deps);
    expect(summary.ran).toBe(false);
    expect(summary.reason).toBe('throttled');
    expect(harness.resolved).toEqual([]);
    expect(harness.stamps).toEqual([]);
  });

  it('drops a verified result whose did does not match the stored did (never merges)', async () => {
    const harness = freshHarness();
    const deps = makeDeps(harness, aliceSnapshots, () => ({
      kind: 'verified',
      // Validly-signed, npub-claiming — but a DIFFERENT identity.
      record: record('did:key:zEve', [`nostr:${NPUB_A}`]),
      jws: 'h.p.s3',
    }));
    const summary = await refreshVerifiedContactsOnce(deps);
    expect(summary).toEqual({ ran: true, checked: 1, saved: 0, unchanged: 0, dropped: 1, failed: 0 });
    expect(harness.merged).toEqual([]);
  });

  it('counts invalid results as silent per-contact failures', async () => {
    const harness = freshHarness();
    const snapshots = [
      verified('did:key:zAlice', [`nostr:${NPUB_A}`]),
      verified('did:key:zBrig', [`nostr:${NPUB_B}`]),
    ];
    const deps = makeDeps(harness, snapshots, (npub) =>
      npub === NPUB_A
        ? { kind: 'invalid', reason: 'unreachable' }
        : {
            kind: 'verified',
            record: record('did:key:zBrig', [`nostr:${NPUB_B}`]),
            jws: 'h.p.s4',
          }
    );
    const summary = await refreshVerifiedContactsOnce(deps);
    expect(summary).toEqual({ ran: true, checked: 2, saved: 1, unchanged: 0, dropped: 0, failed: 1 });
  });

  it('skips entirely (without stamping) when there are no candidates', async () => {
    const harness = freshHarness();
    const deps = makeDeps(harness, [], () => {
      throw new Error('must not resolve with no candidates');
    });
    const summary = await refreshVerifiedContactsOnce(deps);
    expect(summary.ran).toBe(false);
    expect(summary.reason).toBe('empty');
    expect(harness.stamps).toEqual([]);
  });
});
