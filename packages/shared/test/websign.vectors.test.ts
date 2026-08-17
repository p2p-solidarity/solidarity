/**
 * webSign.ts — App↔Web per-action remote-signing envelopes (research
 * notes-1.3.3 §4). Round-trip (buildWebSignRequest → signWebSignRequest →
 * verifyWebSignRequest, and the response mirror) plus consumption of the
 * frozen conformance/adversarial vectors in ../vectors/websign.json — the
 * same vectors airmeishi-web will later replay against its own
 * implementation. Adversarial coverage (research §8 "QR 互簽" row): expired,
 * replayed / rebound, request substitution, draft tampered after digest,
 * unknown action, unknown extra field, oversized draft, wrong-key
 * signature, kid≠did, and a response whose embedded record ≠ the draft.
 */
import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import { base64UrlDecode } from '../src/crypto/base64';
import { hexToBytes } from '../src/crypto/hex';
import { didKeyFromPublicKey, publicKeyFromPrivate } from '../src/identity';
import { signCompact, type Signer } from '../src/jws';
import type { ProfileRecord } from '../src/profile';
import { unwrap } from '../src/types/result';
import {
  buildWebSignRequest,
  buildWebSignResponse,
  signWebSignRequest,
  signWebSignResponse,
  verifyWebSignRequest,
  verifyWebSignResponse,
  WEB_SIGN_DRAFT_MAX_BYTES,
  type OutstandingWebSignRequest,
} from '../src/webSign';
import vectors from '../vectors/websign.json';

const signerFor = (privHex: string): Signer => {
  const priv = hexToBytes(privHex);
  return async (digest) => p256.sign(digest, priv, { prehash: false });
};

const ROOT_DID = vectors.testKeys.root.did;
const SESSION_DID = vectors.testKeys.session.did;
const rootSigner = signerFor(vectors.testKeys.root.privateKeyHex);
const sessionSigner = signerFor(vectors.testKeys.session.privateKeyHex);

const { iat, exp, nowMs } = vectors.timestamps;
const draft = vectors.draft as ProfileRecord;
const REQUEST_ID = base64UrlEncode32();
const NONCE = base64UrlEncode16();

function base64UrlEncode32(): string {
  // 32-byte requestId (≥256-bit) — mirrors the generator.
  return Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => i)).toString('base64url');
}
function base64UrlEncode16(): string {
  return Buffer.from(Uint8Array.from({ length: 16 }, (_, i) => i)).toString('base64url');
}

describe('websign.json test keys', () => {
  for (const role of ['root', 'session', 'attacker'] as const) {
    test(`${role}.did is derived from ${role}.privateKeyHex`, () => {
      const priv = hexToBytes(vectors.testKeys[role].privateKeyHex);
      expect(didKeyFromPublicKey(publicKeyFromPrivate(priv))).toBe(vectors.testKeys[role].did);
    });
  }
});

describe('buildWebSignRequest / signWebSignRequest / verifyWebSignRequest — round trip', () => {
  test('a freshly built+signed request verifies and returns the parsed record', async () => {
    const req = buildWebSignRequest({
      requestId: REQUEST_ID,
      nonce: NONCE,
      originHint: 'https://app.solidarity.gg',
      webSessionDid: SESSION_DID,
      draft,
      iat,
      exp,
    });
    const jws = await signWebSignRequest(req, SESSION_DID, sessionSigner);
    const result = verifyWebSignRequest(jws, { nowMs });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.webSessionDid).toBe(SESSION_DID);
      expect(result.value.action).toBe('profile.sign');
      expect(result.value.draft.displayName).toBe('Alice');
    }
  });

  test('signWebSignRequest throws when webSessionDid != req.webSessionDid (caller bug)', async () => {
    const req = buildWebSignRequest({
      requestId: REQUEST_ID,
      nonce: NONCE,
      originHint: '',
      webSessionDid: SESSION_DID,
      draft,
      iat,
      exp,
    });
    await expect(signWebSignRequest(req, ROOT_DID, rootSigner)).rejects.toThrow();
  });

  test('rejects a draft whose canonical size exceeds the cap (draftTooLarge)', async () => {
    const bigDraft = { ...draft, bio: 'x'.repeat(WEB_SIGN_DRAFT_MAX_BYTES + 1) } as ProfileRecord;
    const req = buildWebSignRequest({
      requestId: REQUEST_ID,
      nonce: NONCE,
      originHint: '',
      webSessionDid: SESSION_DID,
      draft: bigDraft,
      iat,
      exp,
    });
    const jws = await signWebSignRequest(req, SESSION_DID, sessionSigner);
    const result = verifyWebSignRequest(jws, { nowMs });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('draftTooLarge');
  });

  test('malformed envelopes fail closed as malformedEnvelope', () => {
    expect(verifyWebSignRequest('not-a-jws', { nowMs }).ok).toBe(false);
    const twoParts = verifyWebSignRequest('aaa.bbb', { nowMs });
    expect(twoParts.ok).toBe(false);
    if (!twoParts.ok) expect(twoParts.error.kind).toBe('malformedEnvelope');
  });

  test('a payload with no webSessionDid is rejected before signature checks (malformedEnvelope)', async () => {
    // Sign a syntactically-valid JWS whose payload omits webSessionDid.
    const jws = await signCompact({ v: 1, typ: 'solidarity.webSignRequest.v1' }, SESSION_DID, sessionSigner);
    const result = verifyWebSignRequest(jws, { nowMs });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('malformedEnvelope');
  });
});

describe('buildWebSignResponse / signWebSignResponse / verifyWebSignResponse — round trip', () => {
  async function freshOutstanding(): Promise<OutstandingWebSignRequest> {
    const req = buildWebSignRequest({
      requestId: REQUEST_ID,
      nonce: NONCE,
      originHint: 'https://app.solidarity.gg',
      webSessionDid: SESSION_DID,
      draft,
      iat,
      exp,
    });
    const jws = await signWebSignRequest(req, SESSION_DID, sessionSigner);
    return { jws, request: unwrap(verifyWebSignRequest(jws, { nowMs })) };
  }

  test('a response bound to its request verifies and returns the final record', async () => {
    const outstanding = await freshOutstanding();
    const profileJws = await signCompact(draft, ROOT_DID, rootSigner);
    const res = buildWebSignResponse(outstanding, profileJws, iat, exp);
    const jws = await signWebSignResponse(res, ROOT_DID, rootSigner);
    const result = verifyWebSignResponse(jws, ROOT_DID, outstanding, { nowMs });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.did).toBe(ROOT_DID);
  });

  test('rejects a response verified against a different outstanding request (rebind)', async () => {
    const outstanding = await freshOutstanding();
    const profileJws = await signCompact(draft, ROOT_DID, rootSigner);
    const res = buildWebSignResponse(outstanding, profileJws, iat, exp);
    const jws = await signWebSignResponse(res, ROOT_DID, rootSigner);

    const differentRequestId = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i)).toString('base64url');
    const otherOutstanding: OutstandingWebSignRequest = {
      ...outstanding,
      request: { ...outstanding.request, requestId: differentRequestId },
    };
    const result = verifyWebSignResponse(jws, ROOT_DID, otherOutstanding, { nowMs });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('requestMismatch');
  });
});

describe('websign.json conformance vectors — request', () => {
  for (const v of vectors.request.valid) {
    test(`valid: ${v.name}`, () => {
      expect(verifyWebSignRequest(v.jws, v.opts).ok).toBe(true);
    });
  }
  for (const v of vectors.request.invalid) {
    test(`invalid: ${v.name} -> ${v.errorKind}`, () => {
      const result = verifyWebSignRequest(v.jws, v.opts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(v.errorKind);
    });
  }
});

describe('websign.json conformance vectors — response', () => {
  const outstanding: OutstandingWebSignRequest = {
    jws: vectors.outstandingJws,
    request: unwrap(verifyWebSignRequest(vectors.outstandingJws, { nowMs })),
  };

  for (const v of vectors.response.valid) {
    test(`valid: ${v.name}`, () => {
      expect(verifyWebSignResponse(v.jws, ROOT_DID, outstanding, v.opts).ok).toBe(true);
    });
  }
  for (const v of vectors.response.invalid) {
    test(`invalid: ${v.name} -> ${v.errorKind}`, () => {
      const result = verifyWebSignResponse(v.jws, ROOT_DID, outstanding, v.opts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(v.errorKind);
    });
  }
});
