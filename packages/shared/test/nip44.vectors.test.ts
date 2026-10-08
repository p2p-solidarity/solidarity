/**
 * NIP-44 v2 — pinned to the OFFICIAL vectors (paulmillr/nip44, curated into
 * vectors/nip44.json): conversation-key derivation, the padding table, full
 * encrypt/decrypt with fixed nonces, and the invalid-payload rejections.
 * Plus roundtrip + tamper properties with random nonces.
 */
import { describe, expect, it } from 'bun:test';

import { secp256k1 } from '@noble/curves/secp256k1.js';

import {
  bytesToHex,
  hexToBytes,
  nip44CalcPaddedLen,
  nip44ConversationKey,
  nip44Decrypt,
  nip44Encrypt,
  sha256Bytes,
  utf8ToBytes,
} from '../src/crypto';

import vectors from '../vectors/nip44.json';

const sha256Hex = (s: string): string => bytesToHex(sha256Bytes(utf8ToBytes(s)));

function xOnlyPub(secHex: string): Uint8Array {
  return secp256k1.getPublicKey(hexToBytes(secHex), true).subarray(1);
}

describe('nip44ConversationKey (official vectors)', () => {
  for (const [i, v] of vectors.get_conversation_key.entries()) {
    it(`vector ${String(i)}`, () => {
      const key = nip44ConversationKey(hexToBytes(v.sec1), hexToBytes(v.pub2));
      expect(bytesToHex(key)).toBe(v.conversation_key);
    });
  }

  it('is symmetric between the two parties', () => {
    const v = vectors.encrypt_decrypt[0]!;
    const a = nip44ConversationKey(hexToBytes(v.sec1), xOnlyPub(v.sec2));
    const b = nip44ConversationKey(hexToBytes(v.sec2), xOnlyPub(v.sec1));
    expect(bytesToHex(a)).toBe(bytesToHex(b));
    expect(bytesToHex(a)).toBe(v.conversation_key);
  });
});

describe('nip44CalcPaddedLen (official table)', () => {
  it('matches every table entry', () => {
    for (const [unpadded, padded] of vectors.calc_padded_len) {
      expect(nip44CalcPaddedLen(unpadded!)).toBe(padded!);
    }
  });
});

describe('nip44 encrypt/decrypt (official vectors)', () => {
  for (const [i, v] of vectors.encrypt_decrypt.entries()) {
    it(`vector ${String(i)}: "${v.plaintext.slice(0, 16)}"`, () => {
      const convKey = hexToBytes(v.conversation_key);
      const payload = nip44Encrypt(convKey, v.plaintext, hexToBytes(v.nonce));
      expect(payload).toBe(v.payload);
      expect(nip44Decrypt(convKey, v.payload)).toBe(v.plaintext);
    });
  }
});

describe('nip44 long messages (official encrypt_decrypt_long_msg — the max-size regression)', () => {
  for (const [i, v] of vectors.encrypt_decrypt_long_msg.entries()) {
    it(`vector ${String(i)}: '${v.pattern}' ×${String(v.repeat)}`, () => {
      const convKey = hexToBytes(v.conversation_key);
      const plaintext = v.pattern.repeat(v.repeat);
      // Sanity: our plaintext reconstruction matches the vector's hash.
      expect(sha256Hex(plaintext)).toBe(v.plaintext_sha256);
      // Encrypt with the fixed nonce → payload hash must match the vector.
      const payload = nip44Encrypt(convKey, plaintext, hexToBytes(v.nonce));
      expect(bytesToHex(sha256Bytes(utf8ToBytes(payload)))).toBe(v.payload_sha256);
      // And it must round-trip back — the 65535-byte case is exactly what the
      // old MAX_PAYLOAD_BYTES=65601 bound wrongly rejected.
      expect(nip44Decrypt(convKey, payload)).toBe(plaintext);
    });
  }
});

describe('nip44Decrypt rejections (official invalid vectors)', () => {
  for (const [i, v] of vectors.invalid_decrypt.entries()) {
    it(`vector ${String(i)}: ${v.note}`, () => {
      expect(() => nip44Decrypt(hexToBytes(v.conversation_key), v.payload)).toThrow();
    });
  }
});

describe('nip44 properties', () => {
  const conv = nip44ConversationKey(
    hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
    xOnlyPub('0000000000000000000000000000000000000000000000000000000000000002')
  );

  it('roundtrips with a random nonce and never repeats payloads', () => {
    const a = nip44Encrypt(conv, '名片限定欄位 — restricted field');
    const b = nip44Encrypt(conv, '名片限定欄位 — restricted field');
    expect(a).not.toBe(b);
    expect(nip44Decrypt(conv, a)).toBe('名片限定欄位 — restricted field');
    expect(nip44Decrypt(conv, b)).toBe('名片限定欄位 — restricted field');
  });

  it('rejects a single flipped ciphertext byte (MAC)', () => {
    const payload = nip44Encrypt(conv, 'tamper me');
    const raw = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
    raw[40] = (raw[40] ?? 0) ^ 0x01;
    const tampered = btoa(String.fromCharCode(...raw));
    expect(() => nip44Decrypt(conv, tampered)).toThrow('invalid MAC');
  });

  it('rejects empty and oversized plaintext', () => {
    expect(() => nip44Encrypt(conv, '')).toThrow();
    expect(() => nip44Encrypt(conv, 'x'.repeat(65536))).toThrow();
  });
});
