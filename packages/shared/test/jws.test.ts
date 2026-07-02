/**
 * jws.ts — compact JWS (ES256, did:key) sign + verify. Covers the
 * signCompact/verifyCompact contract directly, plus consumption of the
 * frozen conformance vectors in ../vectors/jws.json — the same vectors the
 * web viewer will later replay against its own implementation (03-spec §3).
 */
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import { signCompact, verifyCompact, type Signer } from '../src/jws';
import { didKeyFromPublicKey, publicKeyFromPrivate, publicKeyToJwk } from '../src/identity';
import { base64UrlDecode, base64UrlEncode, bytesToUtf8, utf8ToBytes } from '../src/crypto/base64';
import { sha256Bytes } from '../src/crypto/hash';
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

// `{ prehash: false }` — `digest` is already the single-SHA-256 RFC 7515
// ES256 message representative computed by signCompact; @noble/curves
// defaults to `prehash: true` and would hash it a second time.
const testSigner: Signer = async (digest) => p256.sign(digest, TEST_PRIV, { prehash: false });

function decodeSegment(b64url: string): Record<string, unknown> {
  return JSON.parse(bytesToUtf8(base64UrlDecode(b64url))) as Record<string, unknown>;
}

/**
 * Builds a compact JWS from an arbitrary (possibly non-conformant) header
 * object, validly signed with the real test key over the exact resulting
 * signing input. Used to prove attack-vector tests are exercising
 * verifyCompact's *policy* checks (header shape, kid exactness) rather than
 * incidentally failing on signature verification.
 */
function signWithRawHeader(headerObj: object, payloadObj: object): string {
  const headerB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(headerObj)));
  const payloadB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(payloadObj)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const digest = sha256Bytes(signingInput);
  const sigBytes = p256.sign(digest, TEST_PRIV, { prehash: false });
  return `${signingInput}.${base64UrlEncode(sigBytes)}`;
}

/** P-256 group order n — public curve parameter, not a secret. */
const P256_ORDER = p256.Point.Fn.ORDER;

/** Flips a raw r||s signature to its high-S malleable counterpart (r, n-s). */
function flipToHighS(sigBytes: Uint8Array): Uint8Array {
  const sig = p256.Signature.fromBytes(sigBytes);
  return new p256.Signature(sig.r, P256_ORDER - sig.s).toBytes();
}

/**
 * Canonicalizes a raw r||s signature to low-S. WebCrypto's ECDSA sign does
 * not normalize to low-S (unlike @noble/curves, which defaults `lowS:
 * true`), so a signature it produces can otherwise flip a coin on whether
 * verifyCompact's malleability-protection lowS check accepts it.
 */
function normalizeLowS(sigBytes: Uint8Array): Uint8Array {
  const sig = p256.Signature.fromBytes(sigBytes);
  const s = sig.hasHighS() ? P256_ORDER - sig.s : sig.s;
  return new p256.Signature(sig.r, s).toBytes();
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

  test('rejects a header with an extra member beyond {alg, kid} (crit)', () => {
    // Validly signed over this exact (non-conformant) header — if this were
    // rejected, it would have to be because of the header-shape check, not
    // signature failure. RFC 7515 §4.1.11: a verifier that silently ignores
    // unrecognized header members is unsafe.
    const jws = signWithRawHeader(
      { alg: 'ES256', kid: `${TEST_DID}#0`, crit: ['b64'] },
      { scope: 'profile' }
    );
    const result = verifyCompact(jws, TEST_DID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/header/i);
  });

  test('rejects a header with an extra member beyond {alg, kid} (b64)', () => {
    const jws = signWithRawHeader(
      { alg: 'ES256', kid: `${TEST_DID}#0`, b64: false },
      { scope: 'profile' }
    );
    const result = verifyCompact(jws, TEST_DID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/header/i);
  });

  test('rejects kid with a fragment other than #0 (e.g. `${did}#1`)', () => {
    // did:key resolves to exactly one verification method, so `#0` is the
    // only valid fragment — a signer that emits `#1` (or any other
    // fragment) must fail even though the signature itself is valid.
    const jws = signWithRawHeader({ alg: 'ES256', kid: `${TEST_DID}#1` }, { scope: 'profile' });
    const result = verifyCompact(jws, TEST_DID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/kid/i);
  });

  test('rejects a high-S (malleable) signature — lowS protection preserved under prehash:false', async () => {
    const jws = await signCompact({ a: 1 }, TEST_DID, testSigner);
    const [headerB64, payloadB64, sigB64] = jws.split('.');
    const sigBytes = base64UrlDecode(sigB64!);
    const sig = p256.Signature.fromBytes(sigBytes);
    expect(sig.hasHighS()).toBe(false); // sanity: our signer always emits low-S

    const highSBytes = flipToHighS(sigBytes);
    expect(p256.Signature.fromBytes(highSBytes).hasHighS()).toBe(true);
    const tamperedJws = `${headerB64}.${payloadB64}.${base64UrlEncode(highSBytes)}`;
    const result = verifyCompact(tamperedJws, TEST_DID);
    expect(result.ok).toBe(false);
  });
});

describe('verifyCompact — cross-implementation with WebCrypto (kills the double-hash tautology)', () => {
  test('a signature produced by WebCrypto SubtleCrypto verifies via verifyCompact', async () => {
    const priv = hexToBytes(vectors.testKey.privateKeyHex);
    const jwk = publicKeyToJwk(publicKeyFromPrivate(priv));
    const privateCryptoKey = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: base64UrlEncode(priv), ext: true, key_ops: ['sign'] },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign']
    );
    const header = { alg: 'ES256', kid: `${vectors.testKey.did}#0` };
    const headerB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(header)));
    const payload = { hello: 'cross-impl-webcrypto', n: 7 };
    const payloadB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    // WebCrypto's ECDSA SubtleCrypto.sign hashes the message exactly once
    // (SHA-256) and returns the raw r||s signature (64 bytes for P-256) —
    // this is what RFC 7515 ES256 actually specifies. If our verifyCompact
    // still double-hashed (the bug this test exists to catch), this would
    // fail.
    const sigBuf = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateCryptoKey,
      utf8ToBytes(signingInput)
    );
    // WebCrypto does not canonicalize to low-S (unlike our signer); our
    // verifier enforces lowS as malleability protection, so normalize
    // before constructing the JWS — otherwise this test would be ~50%
    // flaky depending on WebCrypto's internal nonce.
    const sigBytes = normalizeLowS(new Uint8Array(sigBuf));
    const jws = `${signingInput}.${base64UrlEncode(sigBytes)}`;

    const result = verifyCompact(jws, vectors.testKey.did);
    expect(result.ok).toBe(true);
    expect(unwrap(result)).toEqual(payload);
  });

  test('signCompact output verifies via WebCrypto SubtleCrypto.verify', async () => {
    const pubCryptoKey = await crypto.subtle.importKey(
      'raw',
      publicKeyFromPrivate(TEST_PRIV),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    );
    const payload = { hello: 'cross-impl-us', n: 3 };
    const jws = await signCompact(payload, TEST_DID, testSigner);
    const [headerB64, payloadB64, sigB64] = jws.split('.');
    const signingInput = `${headerB64}.${payloadB64}`;
    const sigBytes = base64UrlDecode(sigB64!);

    // If signCompact still double-hashed (the bug this test exists to
    // catch), a spec-compliant verifier hashing once would reject this.
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubCryptoKey,
      sigBytes,
      utf8ToBytes(signingInput)
    );
    expect(valid).toBe(true);
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
