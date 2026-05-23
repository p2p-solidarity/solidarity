/**
 * SHA-256 wrapper over @noble/hashes — used everywhere Swift calls
 * `SHA256.hash(data:)` (passport SOD hashing, JWT digest, identity
 * commitment, etc.).
 */
import { sha256 } from '@noble/hashes/sha2.js';

import { utf8ToBytes } from './base64';

export function sha256Bytes(input: Uint8Array | string): Uint8Array {
  return sha256(typeof input === 'string' ? utf8ToBytes(input) : input);
}
