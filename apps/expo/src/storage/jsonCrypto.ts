/**
 * jsonCrypto — pure, key-explicit JSON AES-256-GCM encrypt/decrypt.
 *
 * Split out of `encryptionManager.ts` so the key-based primitives can be
 * imported + unit-tested WITHOUT pulling in `secureMasterKey.ts` (which eagerly
 * imports `expo-secure-store`, unparseable in the bun test runtime). This
 * module imports ONLY `@solidarity/shared`, so it is import-safe everywhere.
 *
 * `encryptionManager.ts` layers the Device Storage Key on top
 * (`encryptJson`/`decryptJson` = these helpers bound to `getMasterKey()`); the
 * cross-device Backup Archive path binds them to the Recovery-Phrase-derived
 * Portable Backup Key instead (see `docs/adr/0001`). The byte layout is
 * unchanged (`nonce(12) || ct || tag(16)`, base64), so both key schemes share
 * the exact same wire format — only the key differs.
 */
import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToUtf8,
  utf8ToBytes,
} from '@solidarity/shared';

/**
 * Thrown when AES-GCM open fails — a wrong key (e.g. a Backup Archive sealed
 * under a DIFFERENT Portable Backup Key / Device Storage Key than the one on
 * this device) or tampered ciphertext. Typed so callers (backup restore) can
 * distinguish it from I/O failures and show a clear "different key" message.
 */
export class DecryptError extends Error {
  constructor(message = 'decrypt-failed', options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DecryptError';
  }
}

// Set/Map have no enumerable own props, so JSON.stringify(new Set(['a'])) is
// "{}" and the entries vanish. Convert them to plain arrays at the boundary so
// runtime Sets (e.g. SharingPreferences.publicFields) round-trip through disk.
export function jsonReplacer(_key: string, val: unknown): unknown {
  if (val instanceof Set) return Array.from(val);
  if (val instanceof Map) return Array.from(val.entries());
  return val;
}

/**
 * Serialise + encrypt `value` under an EXPLICIT 32-byte key. Returns base64 of
 * the Swift-compatible combined blob (`nonce || ciphertext || tag`). A fresh
 * random 96-bit nonce is generated per call by `aesGcmSeal`, so reusing one
 * derived key across many archives is safe.
 */
export function encryptJsonWithKey(key: Uint8Array, value: unknown): string {
  const plaintext = utf8ToBytes(JSON.stringify(value, jsonReplacer));
  return base64Encode(aesGcmSeal(key, plaintext));
}

/**
 * Decrypt + parse JSON with an EXPLICIT 32-byte key. Throws `DecryptError` on
 * an auth-tag failure (wrong key / tampering); JSON parsing stays OUTSIDE the
 * catch so a parse bug isn't mislabelled as a key mismatch.
 */
export function decryptJsonWithKey<T = unknown>(key: Uint8Array, blob: string): T {
  const combined = base64Decode(blob);
  let plaintext: Uint8Array;
  try {
    plaintext = aesGcmOpen(key, combined);
  } catch (cause) {
    throw new DecryptError('decrypt-failed', { cause });
  }
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}
