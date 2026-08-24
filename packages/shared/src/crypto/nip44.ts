/**
 * NIP-44 v2 — versioned encryption to a Nostr pubkey (the "可選 lane" from
 * docs/ref/05-spec-qr-exchange.md §3, ruling 2026-08-25: Pear stays the
 * private-exchange channel; NIP-44 is the optional relay-mediated lane for
 * card-restricted fields once per-recipient publishing lands).
 *
 * Implemented from the NIP-44 spec, pinned by the OFFICIAL test vectors
 * (packages/shared/vectors/nip44.json, curated from paulmillr/nip44):
 *
 *   conversation key = hkdf_extract(sha256,
 *     ikm  = x-coordinate of secp256k1 ECDH(privA, pubB),
 *     salt = utf8("nip44-v2"))
 *   message keys     = hkdf_expand(convKey, nonce(32), 76)
 *                      → chacha_key(32) ‖ chacha_nonce(12) ‖ hmac_key(32)
 *   padded           = u16-BE(len) ‖ plaintext ‖ zeros → calcPaddedLen
 *   ciphertext       = chacha20(chacha_key, chacha_nonce, padded)
 *   mac              = hmac_sha256(hmac_key, nonce ‖ ciphertext)
 *   payload          = base64(0x02 ‖ nonce ‖ ciphertext ‖ mac)
 *
 * Decrypt fails closed (throws) on: '#' prefix (unsupported future
 * version), wrong version byte, out-of-bounds lengths, MAC mismatch
 * (constant-time compare), or padding that doesn't match calcPaddedLen
 * exactly. This module is a pure primitive — no key custody, no policy;
 * callers hold the secp256k1 keys (the Nostr publish key lane,
 * apps/expo/src/nostr/userKey.ts).
 */
import { chacha20 } from '@noble/ciphers/chacha.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { extract, expand } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { base64Decode, base64Encode, utf8ToBytes } from './base64';

const VERSION = 2;
const SALT = utf8ToBytes('nip44-v2');
const NONCE_LENGTH = 32;
const MAC_LENGTH = 32;
const MIN_PLAINTEXT_LENGTH = 1;
const MAX_PLAINTEXT_LENGTH = 65535;
/** The ciphertext is the padded block: `2` (u16 length prefix) + calcPaddedLen.
 *  Min padded = 2 + 32 = 34; max padded = 2 + 65536 = 65538. */
const MIN_PADDED_BYTES = 2 + 32;
const MAX_PADDED_BYTES = 2 + 65536;
/** version(1) + nonce(32) + min ciphertext(34) + mac(32) = 99 (NIP-44 spec). */
const MIN_PAYLOAD_BYTES = 1 + NONCE_LENGTH + MIN_PADDED_BYTES + MAC_LENGTH;
/** version(1) + nonce(32) + max ciphertext(65538) + mac(32) = 65603 (NIP-44 spec). */
const MAX_PAYLOAD_BYTES = 1 + NONCE_LENGTH + MAX_PADDED_BYTES + MAC_LENGTH;

/**
 * Derive the shared conversation key for (our secp256k1 private key, their
 * x-only public key). Symmetric: (privA, pubB) and (privB, pubA) derive the
 * same key. Throws on an invalid scalar/point.
 */
export function nip44ConversationKey(
  privateKey: Uint8Array,
  publicKeyX: Uint8Array
): Uint8Array {
  if (publicKeyX.length !== 32) {
    throw new Error('nip44: public key must be 32 x-only bytes');
  }
  // Lift the x-only key to the even-Y point, per NIP-44 (same convention as
  // BIP-340). getSharedSecret returns the compressed point; the x coordinate
  // (bytes 1..33) is the ECDH output NIP-44 feeds to HKDF (NOT hashed first
  // — this deliberately differs from NIP-04).
  const shared = secp256k1.getSharedSecret(privateKey, concatBytes(new Uint8Array([0x02]), publicKeyX));
  return extract(sha256, shared.subarray(1, 33), SALT);
}

/** The exact padded length the spec mandates for an unpadded byte length. */
export function nip44CalcPaddedLen(unpaddedLen: number): number {
  if (!Number.isSafeInteger(unpaddedLen) || unpaddedLen < 1) {
    throw new Error('nip44: invalid plaintext length');
  }
  if (unpaddedLen <= 32) return 32;
  const nextPower = 1 << (Math.floor(Math.log2(unpaddedLen - 1)) + 1);
  const chunk = nextPower <= 256 ? 32 : nextPower / 8;
  return chunk * (Math.floor((unpaddedLen - 1) / chunk) + 1);
}

/**
 * Encrypt `plaintext` under a conversation key. `nonce` is injectable ONLY
 * for test vectors — production callers must let the 32 random bytes be
 * generated here (a reused nonce leaks the XOR of two padded plaintexts).
 */
export function nip44Encrypt(
  conversationKey: Uint8Array,
  plaintext: string,
  nonce: Uint8Array = randomBytes(NONCE_LENGTH)
): string {
  assertConversationKey(conversationKey);
  if (nonce.length !== NONCE_LENGTH) {
    throw new Error('nip44: nonce must be 32 bytes');
  }
  const unpadded = utf8ToBytes(plaintext);
  if (unpadded.length < MIN_PLAINTEXT_LENGTH || unpadded.length > MAX_PLAINTEXT_LENGTH) {
    throw new Error('nip44: plaintext must be 1..65535 bytes');
  }

  const { chachaKey, chachaNonce, hmacKey } = messageKeys(conversationKey, nonce);
  const padded = new Uint8Array(2 + nip44CalcPaddedLen(unpadded.length));
  padded[0] = (unpadded.length >>> 8) & 0xff;
  padded[1] = unpadded.length & 0xff;
  padded.set(unpadded, 2);

  const ciphertext = chacha20(chachaKey, chachaNonce, padded);
  const mac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  return base64Encode(concatBytes(new Uint8Array([VERSION]), nonce, ciphertext, mac));
}

/** Decrypt a NIP-44 payload. Throws (never partially succeeds) on any
 *  malformed, tampered, or unsupported input. */
export function nip44Decrypt(conversationKey: Uint8Array, payload: string): string {
  assertConversationKey(conversationKey);
  if (payload.startsWith('#')) {
    throw new Error('nip44: unsupported future version');
  }
  const decoded = base64Decode(payload);
  if (decoded.length < MIN_PAYLOAD_BYTES || decoded.length > MAX_PAYLOAD_BYTES) {
    throw new Error('nip44: payload size out of bounds');
  }
  if (decoded[0] !== VERSION) {
    throw new Error('nip44: unknown encryption version');
  }

  const nonce = decoded.subarray(1, 1 + NONCE_LENGTH);
  const ciphertext = decoded.subarray(1 + NONCE_LENGTH, decoded.length - MAC_LENGTH);
  const mac = decoded.subarray(decoded.length - MAC_LENGTH);

  const { chachaKey, chachaNonce, hmacKey } = messageKeys(conversationKey, nonce);
  const expectedMac = hmac(sha256, hmacKey, concatBytes(nonce, ciphertext));
  if (!constantTimeEqual(mac, expectedMac)) {
    throw new Error('nip44: invalid MAC');
  }

  const padded = chacha20(chachaKey, chachaNonce, ciphertext);
  if (padded.length < MIN_PADDED_BYTES) {
    throw new Error('nip44: padded plaintext too short');
  }
  const first = padded[0] ?? 0;
  const second = padded[1] ?? 0;
  const unpaddedLen = (first << 8) | second;
  if (
    unpaddedLen < MIN_PLAINTEXT_LENGTH ||
    unpaddedLen > MAX_PLAINTEXT_LENGTH ||
    padded.length !== 2 + nip44CalcPaddedLen(unpaddedLen)
  ) {
    throw new Error('nip44: invalid padding');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(padded.subarray(2, 2 + unpaddedLen));
}

function messageKeys(
  conversationKey: Uint8Array,
  nonce: Uint8Array
): { chachaKey: Uint8Array; chachaNonce: Uint8Array; hmacKey: Uint8Array } {
  const expanded = expand(sha256, conversationKey, nonce, 76);
  return {
    chachaKey: expanded.subarray(0, 32),
    chachaNonce: expanded.subarray(32, 44),
    hmacKey: expanded.subarray(44, 76),
  };
}

function assertConversationKey(key: Uint8Array): void {
  if (key.length !== 32) throw new Error('nip44: conversation key must be 32 bytes');
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
