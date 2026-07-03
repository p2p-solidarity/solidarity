/**
 * fragment.ts — URL-fragment codec for Profile Record publication (01-spec
 * §4.3: `deflate + base64url` embedded after `#`, QR/offline form).
 * `encodeFragment` never throws and never blocks on size — it reports
 * `oversize` as an informational flag only (QR size budget is a UX
 * concern, not a hard cap). `decodeFragment` never throws — every
 * malformed input (bad base64url, corrupt deflate stream, empty string)
 * returns `err(reason)`. Round-trips against ../vectors/fragment.json, and
 * against every valid profile in ../vectors/profile.json signed as a
 * compact JWS — including the oversize profile vector, which must
 * actually trip `oversize: true` end-to-end through this codec.
 */
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import { decodeFragment, encodeFragment } from '../src/fragment';
import { signCompact, type Signer } from '../src/jws';
import { hexToBytes } from '../src/crypto/hex';
import fragmentVectors from '../vectors/fragment.json';
import profileVectors from '../vectors/profile.json';

const SUBJECT_PRIV = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
const SUBJECT_DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';
const subjectSigner: Signer = async (digest) => p256.sign(digest, SUBJECT_PRIV, { prehash: false });

describe('encodeFragment / decodeFragment — round trip', () => {
  test('a small JWS string round-trips byte-identical', async () => {
    const jws = await signCompact({ hello: 'world' }, SUBJECT_DID, subjectSigner);
    const encoded = encodeFragment(jws);
    expect(encoded.oversize).toBe(false);
    const decoded = decodeFragment(encoded.fragment);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toBe(jws);
  });

  test('reports bytes > 0 and oversize=false for a small payload', () => {
    const encoded = encodeFragment('short-string');
    expect(encoded.bytes).toBeGreaterThan(0);
    expect(encoded.oversize).toBe(false);
  });

  test('every valid profile vector round-trips through sign -> encodeFragment -> decodeFragment -> same JWS', async () => {
    for (const v of profileVectors.valid) {
      const jws = await signCompact(v.profile as object, SUBJECT_DID, subjectSigner);
      const encoded = encodeFragment(jws);
      const decoded = decodeFragment(encoded.fragment);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.value).toBe(jws);
    }
  });

  test('the oversize profile vector trips oversize:true end-to-end', async () => {
    const oversizeVector = profileVectors.valid.find((v) => v.name === 'oversize-fragment-budget');
    expect(oversizeVector).toBeDefined();
    const jws = await signCompact(oversizeVector!.profile as object, SUBJECT_DID, subjectSigner);
    expect(jws.length).toBeGreaterThan(2500);
    const encoded = encodeFragment(jws);
    expect(encoded.oversize).toBe(true);
    // Never blocks — still produces a decodable fragment.
    const decoded = decodeFragment(encoded.fragment);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toBe(jws);
  });
});

describe('decodeFragment — malformed input never throws', () => {
  test('empty string', () => {
    const result = decodeFragment('');
    expect(result.ok).toBe(false);
  });

  test('invalid base64url characters', () => {
    const result = decodeFragment('not!!valid++base64url==');
    expect(result.ok).toBe(false);
  });

  test('valid base64url but not a deflate stream', () => {
    const result = decodeFragment('aGVsbG8gd29ybGQ'); // "hello world" base64url, not deflated
    expect(result.ok).toBe(false);
  });

  test('never throws regardless of input', () => {
    expect(() => decodeFragment('')).not.toThrow();
    expect(() => decodeFragment('!!!')).not.toThrow();
    expect(() => decodeFragment('a'.repeat(10000))).not.toThrow();
  });
});

describe('fragment.json conformance vectors', () => {
  for (const v of fragmentVectors.roundTrip) {
    test(`round-trip: ${v.name}`, () => {
      const encoded = encodeFragment(v.input);
      const decoded = decodeFragment(encoded.fragment);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) expect(decoded.value).toBe(v.input);
    });
  }

  for (const v of fragmentVectors.malformed) {
    test(`malformed: ${v.name}`, () => {
      const result = decodeFragment(v.fragment);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(v.errorContains);
    });
  }
});
