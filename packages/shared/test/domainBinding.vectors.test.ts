import { describe, expect, it } from 'bun:test';

import {
  parseProfile,
  verifyDnsBinding,
  verifyEnsBinding,
  type BadgeState,
  type HandleResolutionError,
  type HandleResolutionResult,
} from '../src';
import dnsVectors from '../vectors/dns-binding.json';
import ensVectors from '../vectors/ens-binding.json';

interface BindingVector {
  readonly name: string;
  readonly profileDid: string;
  readonly alsoKnownAs: readonly string[];
  readonly resolution:
    | { readonly ok: true; readonly did: string }
    | { readonly ok: false; readonly error: HandleResolutionError };
  readonly expected: {
    readonly state: BadgeState;
    readonly direction1: boolean | null;
    readonly direction2: boolean | null;
    readonly profileDidMatches: boolean | null;
    readonly alsoKnownAsMatches: boolean;
  };
}

function profile(did: string, alsoKnownAs: readonly string[]) {
  const parsed = parseProfile({
    v: 1,
    did,
    displayName: 'Alice',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs,
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-19T00:00:00Z',
  });
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function resolution(value: BindingVector['resolution']): HandleResolutionResult {
  return value.ok ? { ok: true, value: { did: value.did } } : { ok: false, error: value.error };
}

describe.each([
  ['dns', dnsVectors, verifyDnsBinding],
  ['ens', ensVectors, verifyEnsBinding],
] as const)('%s bidirectional badge conformance vectors', (_scheme, vectors, verify) => {
  for (const testCase of vectors.cases as readonly BindingVector[]) {
    it(`${testCase.name}: maps fresh evidence honestly`, () => {
      const result = verify(
        profile(testCase.profileDid, testCase.alsoKnownAs),
        vectors.handle,
        resolution(testCase.resolution)
      );

      expect(result.state).toBe(testCase.expected.state);
      expect(result.evidence.direction1).toBe(testCase.expected.direction1);
      expect(result.evidence.direction2).toBe(testCase.expected.direction2);
      expect(result.evidence.profileDidMatches).toBe(testCase.expected.profileDidMatches);
      expect(result.evidence.alsoKnownAsMatches).toBe(testCase.expected.alsoKnownAsMatches);
    });
  }

  it('pins required attack and revocation vectors by name', () => {
    const names = vectors.cases.map((testCase) => testCase.name);
    expect(names).toContain('one-way-no-reverse-aka');
    expect(names).toContain('record-did-does-not-match-resolved-did');
    expect(names.some((name) => name.endsWith('is-revoked'))).toBe(true);
  });
});
