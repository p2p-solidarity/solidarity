import { describe, expect, test } from 'bun:test';

import type { ProfileRecord, VerifyAtprotoBindingResult } from '@solidarity/shared';

import { verifyAtprotoBindingDual } from '@/badges/verifyAtprotoDual';

const baseRecord = (scope: 'full' | 'public'): ProfileRecord =>
  ({
    v: 1,
    did: 'did:key:zDnTest',
    displayName: 'a',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: ['at://alice.bsky.social'],
    badges: [],
    supersededBy: null,
    scope,
    updatedAt: '2026-07-24T00:00:00Z',
  }) as unknown as ProfileRecord;

const outcome = (state: VerifyAtprotoBindingResult['state']): VerifyAtprotoBindingResult =>
  ({
    state,
    handle: 'alice.bsky.social',
    evidence: {
      handleClaim: 'alice.bsky.social',
      repoDid: null,
      recordUri: null,
      direction1: true,
      direction2: state === 'verified',
      reason: state,
    },
  }) as VerifyAtprotoBindingResult;

const io = {} as Parameters<typeof verifyAtprotoBindingDual>[2];

describe('verifyAtprotoBindingDual', () => {
  test('public projection verifies on the first attempt — no fallback call', async () => {
    const calls: ProfileRecord[] = [];
    const result = await verifyAtprotoBindingDual(baseRecord('full'), baseRecord('public'), io, async (record) => {
      calls.push(record);
      return outcome('verified');
    });
    expect(result.state).toBe('verified');
    expect(calls.length).toBe(1);
    expect((calls[0] as { scope?: string }).scope).toBe('public');
  });

  test('falls back to the full record when the PDS still holds the pre-projection copy', async () => {
    const calls: ProfileRecord[] = [];
    const result = await verifyAtprotoBindingDual(baseRecord('full'), baseRecord('public'), io, async (record) => {
      calls.push(record);
      return (record as { scope?: string }).scope === 'full' ? outcome('verified') : outcome('declared');
    });
    expect(result.state).toBe('verified');
    expect(calls.length).toBe(2);
  });

  test('both shapes fail — the public-projection evidence wins', async () => {
    const result = await verifyAtprotoBindingDual(baseRecord('full'), baseRecord('public'), io, async (record) =>
      (record as { scope?: string }).scope === 'public' ? outcome('declared') : outcome('stale')
    );
    expect(result.state).toBe('declared');
  });

  test('no public projection — verifies the full record once', async () => {
    const calls: ProfileRecord[] = [];
    const result = await verifyAtprotoBindingDual(baseRecord('full'), null, io, async (record) => {
      calls.push(record);
      return outcome('declared');
    });
    expect(result.state).toBe('declared');
    expect(calls.length).toBe(1);
  });

  test('identical reference for public and full — no duplicate network call', async () => {
    const record = baseRecord('full');
    const calls: ProfileRecord[] = [];
    const result = await verifyAtprotoBindingDual(record, record, io, async (r) => {
      calls.push(r);
      return outcome('declared');
    });
    expect(result.state).toBe('declared');
    expect(calls.length).toBe(1);
  });
});
