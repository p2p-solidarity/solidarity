/**
 * AES-256-GCM — mirrors solidarity/Services/Utils/EncryptionManager.swift.
 *
 * Swift CryptoKit's `AES.GCM.seal(plaintext, using: key).combined` returns
 *   nonce(12) || ciphertext || tag(16)
 * concatenated. We produce the same byte layout so Swift can decrypt
 * TS-produced ciphertexts and vice-versa (verified by parity tests in
 * apps/expo/__tests__/parity/encryption.parity.test.ts).
 *
 * Key size: 32 bytes (AES-256). 12-byte nonce per spec.
 */
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/hashes/utils';

const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function assertKey(key: Uint8Array): void {
  if (key.length !== KEY_LEN) {
    throw new Error(`AES-256 key must be ${KEY_LEN} bytes (got ${key.length})`);
  }
}

/**
 * Encrypt `plaintext` with `key`. Returns the Swift-compatible combined
 * blob: nonce(12) || ciphertext || tag(16). If `nonce` is omitted, a fresh
 * random one is generated (production path); tests pass a fixed nonce so
 * the output is deterministic.
 */
export function aesGcmSeal(
  key: Uint8Array,
  plaintext: Uint8Array,
  nonce: Uint8Array = randomBytes(NONCE_LEN)
): Uint8Array {
  assertKey(key);
  if (nonce.length !== NONCE_LEN) {
    throw new Error(`nonce must be ${NONCE_LEN} bytes (got ${nonce.length})`);
  }
  const ctTag = gcm(key, nonce).encrypt(plaintext);
  const combined = new Uint8Array(NONCE_LEN + ctTag.length);
  combined.set(nonce, 0);
  combined.set(ctTag, NONCE_LEN);
  return combined;
}

/**
 * Decrypt a combined blob (nonce || ciphertext || tag) produced by Swift
 * CryptoKit `AES.GCM.seal(...).combined` or this module's `aesGcmSeal`.
 */
export function aesGcmOpen(key: Uint8Array, combined: Uint8Array): Uint8Array {
  assertKey(key);
  if (combined.length < NONCE_LEN + TAG_LEN) {
    throw new Error('combined blob too short for AES-GCM');
  }
  const nonce = combined.subarray(0, NONCE_LEN);
  const ctTag = combined.subarray(NONCE_LEN);
  return gcm(key, nonce).decrypt(ctTag);
}

/** Generate a fresh 256-bit symmetric key. */
export const generateAesKey = (): Uint8Array => randomBytes(KEY_LEN);
