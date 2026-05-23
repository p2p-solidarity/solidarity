/**
 * HKDF-SHA256 — mirrors KeyManager.swift's `derive(from:salt:info:length:)`.
 * Wire-compatible with Apple CryptoKit's `HKDF<SHA256>.deriveKey(...)`.
 */
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { utf8ToBytes } from './base64';

export function deriveKey(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array | string,
  length = 32
): Uint8Array {
  const infoBytes = typeof info === 'string' ? utf8ToBytes(info) : info;
  return hkdf(sha256, ikm, salt, infoBytes, length);
}
