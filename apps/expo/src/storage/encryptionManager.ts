/**
 * High-level JSON encrypt/decrypt bound to the **Device Storage Key** —
 * mirrors solidarity/Services/Utils/EncryptionManager.swift's `encrypt<T>` /
 * `decrypt<T>` API.
 *
 * Output byte layout matches Swift CryptoKit `AES.GCM.seal(...).combined`:
 *   nonce(12) || ciphertext || tag(16)
 *
 * The pure, key-explicit primitives live in `./jsonCrypto` (import-safe, no
 * `expo-secure-store`); this module simply binds them to `getMasterKey()`.
 * `encryptJsonWithKey`/`decryptJsonWithKey` are re-exported so callers that
 * need a DIFFERENT key (the cross-device Portable Backup Key — see
 * `docs/adr/0001`) don't reach past this barrel.
 *
 * Parity tests assert: a blob produced by Swift can be decrypted here, and
 * vice-versa. See apps/expo/__tests__/parity/encryption.parity.test.ts.
 */
import {
  DecryptError,
  decryptJsonWithKey,
  encryptJsonWithKey,
} from './jsonCrypto';
import { getMasterKey } from './secureMasterKey';

export { DecryptError, decryptJsonWithKey, encryptJsonWithKey };

/** Serialise + encrypt with the Device Storage Key; base64 combined blob. */
export async function encryptJson(value: unknown): Promise<string> {
  return encryptJsonWithKey(await getMasterKey(), value);
}

/**
 * Decrypt + parse JSON with the Device Storage Key. Throws `DecryptError` on
 * tampering / wrong key and on bad JSON only via the underlying helper's
 * contract. Returns `unknown` — callers must cast (or pipe through a Zod
 * schema for runtime validation).
 */
export async function decryptJson<T = unknown>(blob: string): Promise<T> {
  return decryptJsonWithKey<T>(await getMasterKey(), blob);
}
