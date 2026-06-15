/**
 * SHA wrappers over @noble/hashes.
 *
 * `sha256Bytes` mirrors Swift `SHA256.hash(data:)` — passport SOD hashing,
 * JWT digest, identity commitment, etc.
 *
 * `sha1Bytes` mirrors Swift `Insecure.SHA1.hash(data:)` — only used for
 * Apple Wallet pass manifest checksums (PassKit hardcodes SHA-1 per spec).
 * Do not use for new protocols.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { sha1 } from '@noble/hashes/legacy.js';

import { utf8ToBytes } from './base64';

export function sha256Bytes(input: Uint8Array | string): Uint8Array {
  return sha256(typeof input === 'string' ? utf8ToBytes(input) : input);
}

export function sha1Bytes(input: Uint8Array | string): Uint8Array {
  return sha1(typeof input === 'string' ? utf8ToBytes(input) : input);
}
