/**
 * High-level JSON encrypt/decrypt — mirrors solidarity/Services/Utils/
 * EncryptionManager.swift's `encrypt<T>` / `decrypt<T>` API.
 *
 * Output byte layout matches Swift CryptoKit `AES.GCM.seal(...).combined`:
 *   nonce(12) || ciphertext || tag(16)
 *
 * Parity tests assert: a blob produced by Swift can be decrypted here, and
 * vice-versa. See apps/expo/__tests__/parity/encryption.parity.test.ts.
 */
import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToUtf8,
  utf8ToBytes,
} from '@solidarity/shared';

import { getMasterKey } from './secureMasterKey';

// Set/Map have no enumerable own props, so JSON.stringify(new Set(['a'])) is
// "{}" and the entries vanish. Convert them to plain arrays at the boundary so
// runtime Sets (e.g. SharingPreferences.publicFields) round-trip through disk.
function jsonReplacer(_key: string, val: unknown): unknown {
  if (val instanceof Set) return Array.from(val);
  if (val instanceof Map) return Array.from(val.entries());
  return val;
}

/** Serialise + encrypt; returns base64 of the Swift-compatible combined blob. */
export async function encryptJson(value: unknown): Promise<string> {
  const key = await getMasterKey();
  const plaintext = utf8ToBytes(JSON.stringify(value, jsonReplacer));
  return base64Encode(aesGcmSeal(key, plaintext));
}

/**
 * Decrypt + parse JSON. Throws on tampering or bad JSON.
 * Returns `unknown` — callers must cast to their domain type (or pipe
 * through a Zod schema for runtime validation).
 */
export async function decryptJson<T = unknown>(blob: string): Promise<T> {
  const key = await getMasterKey();
  const combined = base64Decode(blob);
  const plaintext = aesGcmOpen(key, combined);
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}
