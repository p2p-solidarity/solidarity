import { describe, expect, test } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import { hexToBytes } from '../src/crypto/hex';
import type { Signer } from '../src/jws';
import {
  buildPublicDisclosureAttestationPointer,
  buildPublicDisclosureBadgeReference,
  buildPublicDisclosure,
  parsePublicDisclosureAttestationPointer,
  signPublicDisclosure,
  verifyPublicDisclosure,
} from '../src/publicDisclosure';
import vectors from '../vectors/public-disclosure.json';

const ROOT_DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';
const ROOT_PRIVATE_KEY = hexToBytes(
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
);
const rootSigner: Signer = async (digest) =>
  p256.sign(digest, ROOT_PRIVATE_KEY, { prehash: false });

describe('PublicDisclosureRecordV1', () => {
  test('builds, root-signs, and verifies a presence-only age claim', async () => {
    const record = buildPublicDisclosure({
      subject: ROOT_DID,
      slot: '0198a6e4-0c3d-7a21-9657-54a6b6b20275',
      claim: 'age_over_18',
      issuedAt: 1_751_000_000,
      expiresAt: 1_753_592_000,
    });
    const jws = await signPublicDisclosure(record, ROOT_DID, rootSigner);
    const verified = verifyPublicDisclosure(jws, ROOT_DID, {
      nowMs: 1_751_000_100_000,
    });

    expect(verified).toEqual({ ok: true, value: record });
    expect(record.evidence).toEqual({
      format: 'presence',
      value: { claim: 'age_over_18' },
    });
  });

  test('builds and parses the opaque NIP-78 badge pointer round-trip', () => {
    const slot = '0198a6e4-0c3d-7a21-9657-54a6b6b20275';
    const pubkeyHex = 'a'.repeat(64);
    const pointer = buildPublicDisclosureAttestationPointer(pubkeyHex, slot);

    expect(pointer.ok).toBe(true);
    if (!pointer.ok) return;
    expect(parsePublicDisclosureAttestationPointer(pointer.value)).toEqual({
      ok: true,
      value: {
        kind: 30078,
        pubkeyHex,
        dTag: `solidarity.disclosure.public.v1:${slot}`,
        slot,
      },
    });
    expect(buildPublicDisclosureBadgeReference('age_over_18', pubkeyHex, slot)).toEqual({
      ok: true,
      value: {
        type: 'solidarity.publicDisclosure.v1',
        subject: 'age_over_18',
        attestation:
          `nostr:30078:${pubkeyHex}:solidarity.disclosure.public.v1:${slot}`,
      },
    });
  });

  test('fails closed without throwing for malformed input or an invalid clock', async () => {
    expect(verifyPublicDisclosure('not-a-jws', ROOT_DID)).toEqual({
      ok: false,
      error: { kind: 'malformedEnvelope', detail: 'expected 3 JWS parts' },
    });

    const record = buildPublicDisclosure({
      subject: ROOT_DID,
      slot: '0198a6e4-0c3d-7a21-9657-54a6b6b20275',
      claim: 'age_over_18',
      issuedAt: 1_751_000_000,
      expiresAt: 1_753_592_000,
    });
    const jws = await signPublicDisclosure(record, ROOT_DID, rootSigner);
    const invalidClock = verifyPublicDisclosure(jws, ROOT_DID, { nowMs: NaN });
    expect(invalidClock.ok).toBe(false);
    if (!invalidClock.ok) expect(invalidClock.error.kind).toBe('expiryInvalid');
  });
});

describe('public-disclosure.json conformance vectors', () => {
  test('pins the root and attacker DIDs to their private test keys', async () => {
    const { didKeyFromPublicKey, publicKeyFromPrivate } = await import('../src/identity');
    for (const role of ['root', 'attacker'] as const) {
      const privateKey = hexToBytes(vectors.testKeys[role].privateKeyHex);
      expect(didKeyFromPublicKey(publicKeyFromPrivate(privateKey))).toBe(
        vectors.testKeys[role].did
      );
    }
  });

  for (const vector of vectors.valid) {
    test(`valid: ${vector.name}`, () => {
      const result = verifyPublicDisclosure(
        vector.jws,
        vectors.testKeys.root.did,
        vector.opts
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.claim).toBe(vector.claim);
    });
  }

  for (const vector of vectors.invalid) {
    test(`invalid: ${vector.name} -> ${vector.errorKind}`, () => {
      const result = verifyPublicDisclosure(
        vector.jws,
        vectors.testKeys.root.did,
        vector.opts
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(vector.errorKind);
    });
  }

  test('badge pointer vector builds and parses byte-for-byte', () => {
    const built = buildPublicDisclosureAttestationPointer(
      vectors.pointer.pubkeyHex,
      vectors.pointer.slot
    );
    expect(built).toEqual({ ok: true, value: vectors.pointer.attestation });
    expect(parsePublicDisclosureAttestationPointer(vectors.pointer.attestation)).toEqual({
      ok: true,
      value: {
        kind: 30078,
        pubkeyHex: vectors.pointer.pubkeyHex,
        dTag: vectors.pointer.dTag,
        slot: vectors.pointer.slot,
      },
    });
  });
});
