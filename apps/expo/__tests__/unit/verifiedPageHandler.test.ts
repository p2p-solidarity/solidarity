/**
 * Verified Page payload router (1.3.3 Task A2.3, US-11) —
 * `src/scan/verifiedPageHandler.ts`. Pure logic, no RN imports, so this
 * suite drives it directly with no `mock.module` isolation needed.
 *
 * Fixture key reused verbatim from packages/shared's own vectors
 * (vectors/jws.json / vectors/profile.json `testKeys.subject`) so a
 * signed-and-verified fixture here stays cross-checkable against the
 * shared package's own conformance tests.
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  encodeFragment,
  hexToBytes,
  signCompact,
  type Signer,
} from '@solidarity/shared';

import {
  classifyVerifiedPagePayload,
  parseVerifiedPagePayload,
  verifyFragment,
  type VerifiedPageResult,
} from '../../src/scan/verifiedPageHandler';

const SUBJECT_PRIV = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
const SUBJECT_DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';
const subjectSigner: Signer = async (digest) => p256.sign(digest, SUBJECT_PRIV, { prehash: false });

/** Not a real derived did:key — only used as a deliberately-WRONG `kid`
 * binding (see "signed under a different did" below); never resolved to
 * an actual key. */
const WRONG_DID = 'did:key:zWrongSignerFixtureNotARealKey';

function validProfile(overrides: Partial<Record<string, unknown>> = {}): object {
  return {
    v: 1,
    did: SUBJECT_DID,
    displayName: 'Alice',
    avatar: null,
    bio: 'hello',
    links: [],
    alsoKnownAs: [],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-03T00:00:00Z',
    ...overrides,
  };
}

async function signedFragment(profile: object, did = SUBJECT_DID, signer = subjectSigner): Promise<string> {
  const jws = await signCompact(profile, did, signer);
  return encodeFragment(jws).fragment;
}

function expectVerified(result: VerifiedPageResult | null): asserts result is Extract<VerifiedPageResult, { kind: 'verified' }> {
  expect(result).not.toBeNull();
  expect(result?.kind).toBe('verified');
}

function expectInvalid(
  result: VerifiedPageResult | null
): asserts result is Extract<VerifiedPageResult, { kind: 'invalid' }> {
  expect(result).not.toBeNull();
  expect(result?.kind).toBe('invalid');
}

describe('parseVerifiedPagePayload — recognised forms all reach the same verify pipeline', () => {
  it('verifies a full https://solidarity.gg/#<fragment> QR payload', async () => {
    const fragment = await signedFragment(validProfile({ displayName: 'Full URL' }));
    const result = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    expectVerified(result);
    expect(result.record.displayName).toBe('Full URL');
    expect(result.record.did).toBe(SUBJECT_DID);
  });

  it('verifies a bare #<fragment> form (no scheme/host)', async () => {
    const fragment = await signedFragment(validProfile({ displayName: 'Bare hash' }));
    const result = parseVerifiedPagePayload(`#${fragment}`);
    expectVerified(result);
    expect(result.record.displayName).toBe('Bare hash');
  });

  it('verifies a bare fragment blob with no wrapper at all', async () => {
    const fragment = await signedFragment(validProfile({ displayName: 'Bare blob' }));
    const result = parseVerifiedPagePayload(fragment);
    expectVerified(result);
    expect(result.record.displayName).toBe('Bare blob');
  });

  it('accepts any http(s) host, not just solidarity.gg (deep-link domain trust is a separate concern)', async () => {
    const fragment = await signedFragment(validProfile({ displayName: 'Other host' }));
    const result = parseVerifiedPagePayload(`https://example.com/some/path#${fragment}`);
    expectVerified(result);
    expect(result.record.displayName).toBe('Other host');
  });

  it('verifyFragment gives the identical result for an already-extracted fragment (deep-link path)', async () => {
    const fragment = await signedFragment(validProfile({ displayName: 'Direct' }));
    const viaPayload = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    const viaFragment = verifyFragment(fragment);
    if (viaPayload === null) throw new Error('expected a recognised Verified Page payload');
    expect(viaFragment).toEqual(viaPayload);
  });
});

describe('parseVerifiedPagePayload — invalid-but-recognised payloads fail closed with a structured reason', () => {
  it('oversize/corrupt fragment -> decodeFailed', () => {
    const result = parseVerifiedPagePayload('https://solidarity.gg/#not!!valid++base64url==');
    expectInvalid(result);
    expect(result.reason).toBe('decodeFailed');
  });

  it('tampered signature bytes (still decodes, breaks verification) -> verificationFailed', async () => {
    const jws = await signCompact(validProfile(), SUBJECT_DID, subjectSigner);
    const [headerB64, payloadB64, sig] = jws.split('.');
    if (!headerB64 || !payloadB64 || !sig) throw new Error('malformed test fixture JWS');
    // Flip one base64url character inside the signature segment only — the
    // header/payload segments (and hence decodeFragment + the did read)
    // stay byte-identical, isolating this case to signature verification.
    const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    const tamperedJws = `${headerB64}.${payloadB64}.${tamperedSig}`;
    const fragment = encodeFragment(tamperedJws).fragment;
    const result = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    expectInvalid(result);
    expect(result.reason).toBe('verificationFailed');
  });

  it('JWS signed under a different did than the payload claims -> verificationFailed', async () => {
    // signCompact's header `kid` is bound to the did PASSED to it, so
    // signing under WRONG_DID while the payload body claims `did:
    // SUBJECT_DID` produces a JWS whose kid (`${WRONG_DID}#0`) can never
    // satisfy verifyCompact(jws, SUBJECT_DID)'s kid-match check — this
    // never even reaches did resolution / signature math.
    const fragment = await signedFragment(validProfile({ did: SUBJECT_DID }), WRONG_DID, subjectSigner);
    const result = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    expectInvalid(result);
    expect(result.reason).toBe('verificationFailed');
  });

  it('payload with no did field at all -> malformedPayload', async () => {
    const jws = await signCompact({ hello: 'world' }, SUBJECT_DID, subjectSigner);
    const fragment = encodeFragment(jws).fragment;
    const result = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    expectInvalid(result);
    expect(result.reason).toBe('malformedPayload');
  });

  it('validly-signed payload that fails Profile Record schema -> schemaInvalid', async () => {
    // v:2 is schema-invalid (profileRecordSchema.v is a v1 literal) but
    // signCompact happily signs any object — the signature itself is fine.
    const fragment = await signedFragment(validProfile({ v: 2 }));
    const result = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    expectInvalid(result);
    expect(result.reason).toBe('schemaInvalid');
  });

  it('a javascript: link URL smuggled into a schema-valid-looking payload still fails schema (defense in depth)', async () => {
    const fragment = await signedFragment(
      validProfile({ links: [{ label: 'evil', url: 'javascript:alert(1)' }] })
    );
    const result = parseVerifiedPagePayload(`https://solidarity.gg/#${fragment}`);
    expectInvalid(result);
    expect(result.reason).toBe('schemaInvalid');
  });
});

describe('parseVerifiedPagePayload — old-format passthrough (not mine)', () => {
  it('returns null for a bare compact-JWT-shaped payload (old didSigned wire format)', async () => {
    const jws = await signCompact({ vc: { credentialSubject: {} } }, SUBJECT_DID, subjectSigner);
    expect(parseVerifiedPagePayload(jws)).toBeNull();
  });

  it('returns null for an sce1: compressed envelope payload', () => {
    expect(parseVerifiedPagePayload('sce1:SGVsbG8gd29ybGQ')).toBeNull();
  });

  it('returns null for a plain JSON envelope payload', () => {
    expect(parseVerifiedPagePayload('{"format":"plaintext","plaintext":{}}')).toBeNull();
  });

  it('returns null for a BEGIN:VCARD payload', () => {
    expect(parseVerifiedPagePayload('BEGIN:VCARD\nVERSION:3.0\nFN:Alice\nEND:VCARD')).toBeNull();
  });

  it('returns null for an openid4vp:// request URL', () => {
    expect(parseVerifiedPagePayload('openid4vp://present?client_id=x&request_uri=y')).toBeNull();
  });

  it('returns null for a solidarity:// deep link', () => {
    expect(parseVerifiedPagePayload('solidarity://card/11111111-2222-4333-8444-555555555555')).toBeNull();
  });

  it('returns null for an https URL with no hash at all', () => {
    expect(parseVerifiedPagePayload('https://solidarity.gg/some/page')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parseVerifiedPagePayload('')).toBeNull();
  });

  it('returns null for non-string input without throwing', () => {
    // @ts-expect-error — exercising the runtime guard against a
    // non-string scan payload (defensive; the scanner always hands us a
    // string, but this proves the guard is a hard `null`, not a throw).
    expect(() => parseVerifiedPagePayload(null)).not.toThrow();
    // @ts-expect-error — same non-string-input guard, asserted on the return value.
    expect(parseVerifiedPagePayload(null)).toBeNull();
  });
});

describe('classifyVerifiedPagePayload — handle reads', () => {
  it('classifies explicit DNS, natural ENS, and bare/@ ATProto handles', () => {
    expect(classifyVerifiedPagePayload('dns:Example.COM')).toEqual({
      kind: 'handle',
      handle: 'dns:Example.COM',
    });
    expect(classifyVerifiedPagePayload('Vitalik.ETH')).toEqual({
      kind: 'handle',
      handle: 'Vitalik.ETH',
    });
    expect(classifyVerifiedPagePayload('@alice.bsky.social')).toEqual({
      kind: 'handle',
      handle: '@alice.bsky.social',
    });
    expect(classifyVerifiedPagePayload('alice.example')).toEqual({
      kind: 'handle',
      handle: 'alice.example',
    });
  });

  it('classifies product /@handle links but not the same path on a third-party host', () => {
    expect(classifyVerifiedPagePayload('https://app.solidarity.gg/@dns:example.com')).toEqual({
      kind: 'handle',
      handle: 'dns:example.com',
    });
    expect(classifyVerifiedPagePayload('http://app.solidarity.gg/@dns:example.com')).toBeNull();
    expect(classifyVerifiedPagePayload('https://example.com/@dns:example.com')).toBeNull();
  });
});
