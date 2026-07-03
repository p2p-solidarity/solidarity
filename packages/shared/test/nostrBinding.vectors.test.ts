/**
 * verifyNostrBinding conformance suite — replays
 * ../vectors/nostr-binding.json (04-plan Phase A4 task A4.3). Every
 * profile in the vector file is also validated through `parseProfile`
 * first (sanity: the vectors themselves must be schema-valid
 * ProfileRecords, not just shaped-for-this-test objects), then each
 * case's `kind0` field is turned into an injected `NostrKind0Fetcher`
 * that resolves exactly that value (or `null`) regardless of the
 * requested pubkey — the fixed value IS the fetcher's whole behaviour
 * for a given case.
 *
 * This file is the app<->web contract test: the future web viewer
 * replays the SAME `nostr-binding.json` against its own IO-injected
 * fetchKind0 wrapper (05-plan V3) and must reach identical `state`/`npub`
 * verdicts case-for-case.
 */
import { describe, expect, it } from 'bun:test';

import { parseProfile } from '../src/profile';
import { verifyNostrBinding, type NostrKind0Fetcher } from '../src/badges/nostr';
import vectors from '../vectors/nostr-binding.json';

interface Kind0Fixture {
  readonly contentJson: unknown;
  readonly created_at: number;
}

interface VectorCase {
  readonly name: string;
  readonly reason: string;
  readonly profile: unknown;
  readonly kind0?: Kind0Fixture | null;
  readonly kind0Unreachable?: string;
  readonly expected: {
    readonly state: string;
    readonly npub: string | null;
    readonly direction1: boolean;
    readonly direction2: boolean | null;
    readonly kind0CreatedAt: number | null;
  };
}

const cases = vectors.cases as readonly VectorCase[];

describe('verifyNostrBinding conformance vectors', () => {
  for (const testCase of cases) {
    it(`${testCase.name}: ${testCase.reason}`, async () => {
      const parsed = parseProfile(testCase.profile);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;

      let callCount = 0;
      const fetchKind0: NostrKind0Fetcher = async (_pubkeyHex: string) => {
        callCount += 1;
        return testCase.kind0 ?? null;
      };

      const result = await verifyNostrBinding(parsed.value, fetchKind0);

      expect(result.state).toBe(testCase.expected.state);
      expect(result.npub).toBe(testCase.expected.npub);
      expect(result.evidence.direction1).toBe(testCase.expected.direction1);
      expect(result.evidence.direction2).toBe(testCase.expected.direction2);
      expect(result.evidence.kind0CreatedAt).toBe(testCase.expected.kind0CreatedAt);

      if (testCase.kind0Unreachable !== undefined) {
        expect(callCount).toBe(0);
      }
    });
  }

  it('has at least one case per reachable state (verified/declared/stale) and covers the mismatch + malformed + absent edge cases by name', () => {
    const names = cases.map((c) => c.name);
    expect(names).toContain('both-directions-verified');
    expect(names).toContain('profile-claims-npub-but-kind0-missing-did');
    expect(names).toContain('did-mismatch');
    expect(names).toContain('kind0-fetch-null');
    expect(names).toContain('no-npub-in-profile');
    expect(names).toContain('malformed-npub-in-profile');

    const states = new Set(cases.map((c) => c.expected.state));
    expect(states.has('verified')).toBe(true);
    expect(states.has('declared')).toBe(true);
    expect(states.has('stale')).toBe(true);
  });
});

describe('verifyNostrBinding — direct unit behaviour not covered by the vector file', () => {
  it('treats a thrown fetchKind0 rejection the same as a null resolution (stale, never propagates the throw)', async () => {
    const throwingFetch: NostrKind0Fetcher = async () => {
      throw new Error('simulated relay socket error');
    };
    const profile = parseProfile((vectors.cases as readonly VectorCase[])[0]!.profile);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    const result = await verifyNostrBinding(profile.value, throwingFetch);
    expect(result.state).toBe('stale');
    expect(result.evidence.direction2).toBe(null);
  });

  it('never calls fetchKind0 more than once per verify call', async () => {
    let callCount = 0;
    const fetchKind0: NostrKind0Fetcher = async () => {
      callCount += 1;
      return { contentJson: { alsoKnownAs: [] }, created_at: 1 };
    };
    const profile = parseProfile((vectors.cases as readonly VectorCase[])[0]!.profile);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    await verifyNostrBinding(profile.value, fetchKind0);
    expect(callCount).toBe(1);
  });
});
