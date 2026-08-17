/**
 * verifyAtprotoBinding conformance suite. Each case injects the handle
 * resolver and PDS record boundaries described by
 * ../vectors/atproto-binding.json, then asserts the shared badge-state
 * verdict that app and viewer consumers must agree on.
 */
import { describe, expect, it } from 'bun:test';

import {
  parseProfile,
  verifyAtprotoBinding,
  type AtprotoBindingIO,
  type BadgeState,
  type ResolverIoError,
} from '../src';
import { err, ok } from '../src/types/result';
import vectors from '../vectors/atproto-binding.json';

interface VectorCase {
  readonly name: string;
  readonly reason: string;
  readonly profile: unknown;
  readonly dnsTxt?: readonly string[];
  readonly dnsError?: ResolverIoError;
  readonly wellKnown?: string | null;
  readonly wellKnownError?: ResolverIoError;
  readonly record?: unknown;
  readonly recordError?: ResolverIoError;
  readonly ioMustNotBeCalled?: boolean;
  readonly expected: {
    readonly state: BadgeState;
    readonly handle: string | null;
    readonly repoDid: string | null;
    readonly recordUri: string | null;
    readonly direction1: boolean;
    readonly direction2: boolean | null;
  };
}

const cases = vectors.cases as readonly VectorCase[];

describe('verifyAtprotoBinding conformance vectors', () => {
  for (const testCase of cases) {
    it(`${testCase.name}: ${testCase.reason}`, async () => {
      const profile = parseProfile(testCase.profile);
      expect(profile.ok).toBe(true);
      if (!profile.ok) return;

      const dnsCalls: string[] = [];
      const fetchCalls: string[] = [];
      const getRecordCalls: string[][] = [];
      const io: AtprotoBindingIO = {
        dnsTxt: async (name) => {
          dnsCalls.push(name);
          return testCase.dnsError === undefined
            ? ok(testCase.dnsTxt ?? [])
            : err(testCase.dnsError);
        },
        fetchText: async (url) => {
          fetchCalls.push(url);
          return testCase.wellKnownError === undefined
            ? ok(testCase.wellKnown ?? null)
            : err(testCase.wellKnownError);
        },
        getRecord: async (repoDid, collection, rkey) => {
          getRecordCalls.push([repoDid, collection, rkey]);
          return testCase.recordError === undefined
            ? ok(testCase.record ?? null)
            : err(testCase.recordError);
        },
      };

      const result = await verifyAtprotoBinding(profile.value, io);

      expect(result.state).toBe(testCase.expected.state);
      expect(result.handle).toBe(testCase.expected.handle);
      expect(result.evidence.repoDid).toBe(testCase.expected.repoDid);
      expect(result.evidence.recordUri).toBe(testCase.expected.recordUri);
      expect(result.evidence.direction1).toBe(testCase.expected.direction1);
      expect(result.evidence.direction2).toBe(testCase.expected.direction2);

      if (testCase.ioMustNotBeCalled === true) {
        expect(dnsCalls).toEqual([]);
        expect(fetchCalls).toEqual([]);
        expect(getRecordCalls).toEqual([]);
      } else if (testCase.expected.repoDid === null) {
        expect(getRecordCalls).toEqual([]);
      } else {
        expect(getRecordCalls).toEqual([
          [testCase.expected.repoDid, 'app.solidarity.profile', 'self'],
        ]);
      }
    });
  }

  it('pins the required valid and attack-vector names', () => {
    const names = cases.map((testCase) => testCase.name);
    expect(names).toContain('both-directions-verified');
    expect(names).toContain('one-way-also-known-as');
    expect(names).toContain('victim-record-copied-to-wrong-repo');
    expect(names).toContain('malformed-record-jws');
    expect(names).toContain('record-signed-by-different-did');
    expect(names).toContain('record-io-unreachable');
    expect(names).toContain('malformed-atproto-handle-claim');
  });
});

describe('verifyAtprotoBinding direct no-throw behavior', () => {
  it('maps a thrown getRecord rejection to stale and calls it only once', async () => {
    const profile = parseProfile(cases[0]!.profile);
    expect(profile.ok).toBe(true);
    if (!profile.ok) return;

    let calls = 0;
    const io: AtprotoBindingIO = {
      dnsTxt: async () => ok(cases[0]!.dnsTxt ?? []),
      fetchText: async () => ok(null),
      getRecord: async () => {
        calls += 1;
        throw new Error('simulated PDS socket failure');
      },
    };

    const result = await verifyAtprotoBinding(profile.value, io);

    expect(result.state).toBe('stale');
    expect(result.evidence.direction2).toBe(null);
    expect(calls).toBe(1);
  });
});
