/**
 * jws.ts — compact JWS (ES256, did:key) sign + verify. Covers the
 * signCompact/verifyCompact contract directly, plus consumption of the
 * frozen conformance vectors in ../vectors/jws.json — the same vectors the
 * web viewer will later replay against its own implementation (03-spec §3).
 */
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import { signCompact, verifyCompact, type Signer } from '../src/jws';
import { didKeyFromPublicKey, publicKeyFromPrivate } from '../src/identity';
import { base64UrlDecode, base64UrlEncode, bytesToUtf8, utf8ToBytes } from '../src/crypto/base64';
import { hexToBytes } from '../src/crypto/hex';
import { unwrap } from '../src/types/result';
import vectors from '../vectors/jws.json';

// TEST-ONLY scalar — never used for anything but these fixtures.
const TEST_PRIV_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const TEST_PRIV = hexToBytes(TEST_PRIV_HEX);
const TEST_DID = didKeyFromPublicKey(publicKeyFromPrivate(TEST_PRIV));

// Distinct, unrelated (also test-only) did:key used to prove kid/did mismatch
// is rejected regardless of which real key is asked about.
const OTHER_DID = 'did:key:zDnaeaQHQpDWivip1SugnEwZaF5JUCmSyPrYewToLKYmv8CyV';

const testSigner: Signer = async (digest) => p256.sign(digest, TEST_PRIV);

function decodeSegment(b64url: string): Record<string, unknown> {
  return JSON.parse(bytesToUtf8(base64UrlDecode(b64url))) as Record<string, unknown>;
}

describe('signCompact / verifyCompact — round trip', () => {
  test('signs and verifies a payload, returning the decoded object', async () => {
    const payload = { hello: 'world', n: 1 };
    const jws = await signCompact(payload, TEST_DID, testSigner);
    const result = verifyCompact(jws, TEST_DID);
    expect(result.ok).toBe(true);
    expect(unwrap(result)).toEqual(payload);
  });

  test('protected header is {alg: ES256, kid: `${did}#0`}', async () => {
    const jws = await signCompact({ a: 1 }, TEST_DID, testSigner);
    const [headerB64] = jws.split('.');
    expect(decodeSegment(headerB64!)).toEqual({ alg: 'ES256', kid: `${TEST_DID}#0` });
  });

  test('different payload key order canonicalizes to the identical signing input', async () => {
    const jwsA = await signCompact({ a: 1, b: 2 }, TEST_DID, testSigner);
    const jwsB = await signCompact({ b: 2, a: 1 }, TEST_DID, testSigner);
    const [headerA, payloadA] = jwsA.split('.');
    const [headerB, payloadB] = jwsB.split('.');
    expect(headerA).toBe(headerB);
    expect(payloadA).toBe(payloadB);
  });

  test('signer must return a 64-byte raw r||s signature', async () => {
    const badSigner: Signer = async () => new Uint8Array(10);
    await expect(signCompact({ a: 1 }, TEST_DID, badSigner)).rejects.toThrow();
  });
});

describe('verifyCompact — error contract (never throws, always returns Result)', () => {
  test('rejects malformed shape (not 3 dot-separated parts)', () => {
    const result = verifyCompact('only.two', TEST_DID);
    expect(result.ok).toBe(false);
  });

  test('rejects unsupported alg', async () => {
    const jws = await signCompact({ a: 1 }, TEST_DID, testSigner);
    const [, payloadB64, sigB64] = jws.split('.');
    const badHeaderB64 = base64UrlEncode(
      utf8ToBytes(JSON.stringify({ alg: 'HS256', kid: `${TEST_DID}#0` }))
    );
    const result = verifyCompact(`${badHeaderB64}.${payloadB64}.${sigB64}`, TEST_DID);
    expect(result.ok).toBe(false);
  });

  test('rejects kid/did mismatch', async () => {
    const jws = await signCompact({ a: 1 }, TEST_DID, testSigner);
    const result = verifyCompact(jws, OTHER_DID);
    expect(result.ok).toBe(false);
  });

  test('rejects a corrupted signature', async () => {
    const jws = await signCompact({ a: 1 }, TEST_DID, testSigner);
    const [headerB64, payloadB64, sigB64] = jws.split('.');
    const sigBytes = base64UrlDecode(sigB64!);
    sigBytes[0] = (sigBytes[0]! ^ 0xff) & 0xff;
    const corruptedSigB64 = base64UrlEncode(sigBytes);
    const result = verifyCompact(`${headerB64}.${payloadB64}.${corruptedSigB64}`, TEST_DID);
    expect(result.ok).toBe(false);
  });

  test('rejects a tampered payload (signature no longer matches)', async () => {
    const jws = await signCompact({ amount: 1 }, TEST_DID, testSigner);
    const [headerB64, , sigB64] = jws.split('.');
    const tamperedPayloadB64 = base64UrlEncode(utf8ToBytes(JSON.stringify({ amount: 999999 })));
    const result = verifyCompact(`${headerB64}.${tamperedPayloadB64}.${sigB64}`, TEST_DID);
    expect(result.ok).toBe(false);
  });
});

describe('jws.json conformance vectors', () => {
  test('testKey.did is derived from testKey.privateKeyHex', () => {
    const priv = hexToBytes(vectors.testKey.privateKeyHex);
    expect(didKeyFromPublicKey(publicKeyFromPrivate(priv))).toBe(vectors.testKey.did);
  });

  for (const v of vectors.valid) {
    test(`valid: ${v.name}`, () => {
      const result = verifyCompact(v.jws, vectors.testKey.did);
      expect(result.ok).toBe(true);
      expect(unwrap(result)).toEqual(v.payload);
    });
  }

  for (const v of vectors.invalid) {
    test(`invalid: ${v.name}`, () => {
      const result = verifyCompact(v.jws, v.did);
      expect(result.ok).toBe(false);
    });
  }
});
