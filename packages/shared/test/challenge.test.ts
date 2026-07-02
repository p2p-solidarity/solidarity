/**
 * challenge.ts — DID-challenge (Verify QR-scan + Pear proximity channel)
 * round trip: buildChallenge -> respondChallenge (signs via signCompact)
 * -> verifyChallengeResponse (verifyCompact under expected.subject +
 * strict field equality + bounded clock skew). Plus consumption of the
 * frozen conformance vectors in ../vectors/challenge.json — the same
 * vectors the web viewer will later replay against its own
 * implementation (03-spec §3).
 */
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  buildChallenge,
  randomChallengeNonce,
  respondChallenge,
  verifyChallengeResponse,
  type Challenge,
} from '../src/challenge';
import { didKeyFromPublicKey, publicKeyFromPrivate } from '../src/identity';
import type { Signer } from '../src/jws';
import { base64UrlDecode } from '../src/crypto/base64';
import { hexToBytes } from '../src/crypto/hex';
import vectors from '../vectors/challenge.json';

// TEST-ONLY scalars — never used for anything but these fixtures.
const SUBJECT_PRIV = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
const SUBJECT_DID = didKeyFromPublicKey(publicKeyFromPrivate(SUBJECT_PRIV));
const subjectSigner: Signer = async (digest) => p256.sign(digest, SUBJECT_PRIV, { prehash: false });

// Distinct test-only scalar from the subject/requester keys below — proves
// "signed by the wrong DID" is rejected regardless of which real key it is.
const OTHER_PRIV = hexToBytes('040b121920272e353c434a51585f666d747b828990979ea5acb3bac1c8cfd6dd');
const OTHER_DID = didKeyFromPublicKey(publicKeyFromPrivate(OTHER_PRIV));
const otherSigner: Signer = async (digest) => p256.sign(digest, OTHER_PRIV, { prehash: false });

// A third, distinct DID used only as a requester label — never signs
// anything, so it must differ from both SUBJECT_DID and OTHER_DID.
const REQUESTER_DID = 'did:key:zDnaeaQHQpDWivip1SugnEwZaF5JUCmSyPrYewToLKYmv8CyV';

function baseChallenge(overrides: Partial<Omit<Challenge, 'v' | 'typ'>> = {}): Challenge {
  return buildChallenge({
    requester: REQUESTER_DID,
    subject: SUBJECT_DID,
    purpose: 'verify.scan',
    nonce: randomChallengeNonce(),
    ts: Math.floor(Date.now() / 1000),
    ...overrides,
  });
}

describe('buildChallenge', () => {
  test('stamps v=1 and typ=solidarity/challenge onto the supplied fields', () => {
    const c = baseChallenge();
    expect(c.v).toBe(1);
    expect(c.typ).toBe('solidarity/challenge');
    expect(c.requester).toBe(REQUESTER_DID);
    expect(c.subject).toBe(SUBJECT_DID);
    expect(c.purpose).toBe('verify.scan');
  });
});

describe('randomChallengeNonce', () => {
  test('produces distinct 32-byte nonces (base64url), never Math.random-derived', () => {
    const a = randomChallengeNonce();
    const b = randomChallengeNonce();
    expect(a).not.toBe(b);
    expect(base64UrlDecode(a).length).toBe(32);
    expect(base64UrlDecode(b).length).toBe(32);
  });
});

describe('buildChallenge / respondChallenge / verifyChallengeResponse — round trip', () => {
  test('a freshly signed challenge response verifies', async () => {
    const c = baseChallenge();
    const jws = await respondChallenge(c, SUBJECT_DID, subjectSigner);
    const result = verifyChallengeResponse(jws, c);
    expect(result.ok).toBe(true);
  });

  test('rejects a response signed by a DID other than expected.subject', async () => {
    const c = baseChallenge();
    const jws = await respondChallenge(c, OTHER_DID, otherSigner);
    const result = verifyChallengeResponse(jws, c);
    expect(result.ok).toBe(false);
  });

  test('rejects when the expected challenge nonce differs from the signed payload (nonce tamper)', async () => {
    const c = baseChallenge();
    const jws = await respondChallenge(c, SUBJECT_DID, subjectSigner);
    const differentNonce: Challenge = { ...c, nonce: randomChallengeNonce() };
    const result = verifyChallengeResponse(jws, differentNonce);
    expect(result.ok).toBe(false);
  });

  test('rejects when the expected purpose differs from the signed payload', async () => {
    const c = baseChallenge({ purpose: 'verify.scan' });
    const jws = await respondChallenge(c, SUBJECT_DID, subjectSigner);
    const differentPurpose: Challenge = { ...c, purpose: 'pear.card' };
    const result = verifyChallengeResponse(jws, differentPurpose);
    expect(result.ok).toBe(false);
  });

  test('rejects when the expected requester differs from the signed payload', async () => {
    const c = baseChallenge();
    const jws = await respondChallenge(c, SUBJECT_DID, subjectSigner);
    const differentRequester: Challenge = { ...c, requester: OTHER_DID };
    const result = verifyChallengeResponse(jws, differentRequester);
    expect(result.ok).toBe(false);
  });

  test('accepts a response within maxSkewSec and rejects one just beyond it (replay-via-timestamp-skew)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const withinSkew = baseChallenge({ ts: nowSec - 100 });
    const withinJws = await respondChallenge(withinSkew, SUBJECT_DID, subjectSigner);
    const withinResult = verifyChallengeResponse(withinJws, withinSkew, { maxSkewSec: 120 });
    expect(withinResult.ok).toBe(true);

    const beyondSkew = baseChallenge({ ts: nowSec - 200 });
    const beyondJws = await respondChallenge(beyondSkew, SUBJECT_DID, subjectSigner);
    const beyondResult = verifyChallengeResponse(beyondJws, beyondSkew, { maxSkewSec: 120 });
    expect(beyondResult.ok).toBe(false);
  });

  test('default maxSkewSec is 120 seconds when opts is omitted', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const withinDefault = baseChallenge({ ts: nowSec - 60 });
    const withinJws = await respondChallenge(withinDefault, SUBJECT_DID, subjectSigner);
    expect(verifyChallengeResponse(withinJws, withinDefault).ok).toBe(true);

    const beyondDefault = baseChallenge({ ts: nowSec - 121 });
    const beyondJws = await respondChallenge(beyondDefault, SUBJECT_DID, subjectSigner);
    expect(verifyChallengeResponse(beyondJws, beyondDefault).ok).toBe(false);
  });

  test('opts.nowMs makes skew evaluation deterministic without mocking Date.now', async () => {
    const c = baseChallenge({ ts: 1_000_000 });
    const jws = await respondChallenge(c, SUBJECT_DID, subjectSigner);

    // 50s later — within default 120s skew.
    const within = verifyChallengeResponse(jws, c, { nowMs: 1_000_050_000 });
    expect(within.ok).toBe(true);

    // 250s later — beyond default 120s skew.
    const beyond = verifyChallengeResponse(jws, c, { nowMs: 1_000_250_000 });
    expect(beyond.ok).toBe(false);
  });
});

describe('challenge.json conformance vectors', () => {
  test('testKeys.subject.did is derived from testKeys.subject.privateKeyHex', () => {
    const priv = hexToBytes(vectors.testKeys.subject.privateKeyHex);
    expect(didKeyFromPublicKey(publicKeyFromPrivate(priv))).toBe(vectors.testKeys.subject.did);
  });

  for (const v of vectors.valid) {
    test(`valid: ${v.name}`, () => {
      const result = verifyChallengeResponse(v.jws, v.expected as Challenge, v.opts);
      expect(result.ok).toBe(true);
    });
  }

  for (const v of vectors.invalid) {
    test(`invalid: ${v.name}`, () => {
      const result = verifyChallengeResponse(v.jws, v.expected as Challenge, v.opts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain(v.errorContains);
    });
  }
});
