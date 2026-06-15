/**
 * Sakura blob ECIES — extended tests.
 *
 * Companion to sakuraBlob.test.ts. Covers additional invariants the Swift
 * MessageService relies on (apps/expo/src/sakura/client.ts +
 * packages/shared/src/sakura/blob.ts):
 *
 *   - Empty payload round-trips (zero-length plaintext is a valid AEAD input)
 *   - Multi-recipient separation: a blob sealed for recipient A cannot be
 *     opened by recipient B even though both keys are valid X25519
 *   - Wire layout matches Swift: first 32 bytes are the ephemeral X25519
 *     public key; next 12 are the AES-GCM nonce; rest is ct||tag (≥ 16B tag)
 *   - Plaintext recovery is byte-equal (no UTF-8 / Date / number coercion)
 *   - Long payload (multi-KB) still round-trips
 *   - Tampered ephemeral pubkey (first 32 bytes) breaks decryption
 *   - Tampered nonce breaks decryption
 *
 * Reads `packages/shared/src/sakura/blob.ts` invariants and Swift's
 * MessageService blob shape exactly (see comment block in blob.ts).
 */
import { describe, expect, it } from 'bun:test';

import {
  bytesToHex,
  bytesToUtf8,
  generateRecipientKeyPair,
  openBlob,
  sealBlob,
  utf8ToBytes,
} from '@solidarity/shared';

const PUB_LEN = 32;
const NONCE_LEN = 12;
const TAG_LEN = 16;

describe('Sakura blob — empty payload round trip', () => {
  it('seals + opens a zero-byte payload', () => {
    const r = generateRecipientKeyPair();
    const blob = sealBlob(r.publicKey, new Uint8Array(0));
    expect(blob.length).toBe(PUB_LEN + NONCE_LEN + TAG_LEN);
    const opened = openBlob(r.privateKey, blob);
    expect(opened.length).toBe(0);
  });
});

describe('Sakura blob — multi-recipient separation', () => {
  it('blob sealed for A cannot be opened by B (even though both are valid)', () => {
    const a = generateRecipientKeyPair();
    const b = generateRecipientKeyPair();
    const blob = sealBlob(a.publicKey, utf8ToBytes('A-only'));
    expect(() => openBlob(b.privateKey, blob)).toThrow();
    // But A can still open it.
    expect(bytesToUtf8(openBlob(a.privateKey, blob))).toBe('A-only');
  });
});

describe('Sakura blob — wire layout matches Swift MessageService', () => {
  it('the first 32 bytes are an ephemeral X25519 public key', () => {
    const r = generateRecipientKeyPair();
    const blob = sealBlob(r.publicKey, utf8ToBytes('payload'));
    // We can't decode an arbitrary X25519 pubkey for content, but we can
    // assert the layout positions: ephemPub is bytes 0..32, nonce is 32..44.
    const ephemPub = blob.subarray(0, PUB_LEN);
    const nonce = blob.subarray(PUB_LEN, PUB_LEN + NONCE_LEN);
    const ct = blob.subarray(PUB_LEN + NONCE_LEN);
    expect(ephemPub.length).toBe(PUB_LEN);
    expect(nonce.length).toBe(NONCE_LEN);
    expect(ct.length).toBeGreaterThanOrEqual(TAG_LEN);
  });

  it('different sender ephemeral keypairs yield distinct ciphertexts of the same plaintext', () => {
    const r = generateRecipientKeyPair();
    const pt = utf8ToBytes('same plaintext');
    const a = sealBlob(r.publicKey, pt);
    const b = sealBlob(r.publicKey, pt);
    // Ephemeral pubkey differs (first 32 bytes).
    expect(bytesToHex(a.subarray(0, PUB_LEN))).not.toBe(
      bytesToHex(b.subarray(0, PUB_LEN))
    );
    // Nonce differs (random per call).
    expect(bytesToHex(a.subarray(PUB_LEN, PUB_LEN + NONCE_LEN))).not.toBe(
      bytesToHex(b.subarray(PUB_LEN, PUB_LEN + NONCE_LEN))
    );
    // Ciphertext therefore differs end-to-end.
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe('Sakura blob — plaintext byte equality', () => {
  it('recovered bytes are byte-equal to the input (no UTF-8 / binary loss)', () => {
    const r = generateRecipientKeyPair();
    // Mix of ASCII, null bytes, and high-bit bytes.
    const pt = new Uint8Array([0, 1, 2, 254, 255, 0x41, 0x42, 0, 0xff]);
    const blob = sealBlob(r.publicKey, pt);
    const opened = openBlob(r.privateKey, blob);
    expect(bytesToHex(opened)).toBe(bytesToHex(pt));
  });

  it('long payload (>4KB) still round-trips intact', () => {
    const r = generateRecipientKeyPair();
    const pt = new Uint8Array(4097);
    for (let i = 0; i < pt.length; i++) pt[i] = (i * 7) & 0xff;
    const blob = sealBlob(r.publicKey, pt);
    const opened = openBlob(r.privateKey, blob);
    expect(opened.length).toBe(pt.length);
    expect(bytesToHex(opened)).toBe(bytesToHex(pt));
  });
});

describe('Sakura blob — targeted tampering', () => {
  it('flipping a bit in the ephemeral pubkey breaks decryption (wrong ECDH share)', () => {
    const r = generateRecipientKeyPair();
    const blob = sealBlob(r.publicKey, utf8ToBytes('intact'));
    const tampered = new Uint8Array(blob);
    tampered[5] = (tampered[5] ?? 0) ^ 0x01;
    expect(() => openBlob(r.privateKey, tampered)).toThrow();
  });

  it('flipping a bit in the nonce breaks decryption (AES-GCM tag mismatch)', () => {
    const r = generateRecipientKeyPair();
    const blob = sealBlob(r.publicKey, utf8ToBytes('intact'));
    const tampered = new Uint8Array(blob);
    // Byte 32 is the start of the nonce.
    tampered[PUB_LEN + 2] = (tampered[PUB_LEN + 2] ?? 0) ^ 0x01;
    expect(() => openBlob(r.privateKey, tampered)).toThrow();
  });

  it('truncating below the minimum 32 + 12 + 16 = 60 bytes is rejected', () => {
    const r = generateRecipientKeyPair();
    expect(() => openBlob(r.privateKey, new Uint8Array(59))).toThrow();
  });
});
