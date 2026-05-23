/**
 * P-256 key pair primitives — mirrors KeychainService.swift's SecKey ops.
 *
 * Provides:
 *   - generation (RFC 6979 deterministic verification, randomised signing)
 *   - JWK ↔ raw conversion (x963 uncompressed point ↔ {x, y} base64url)
 *   - compressed point encoding for did:key multicodec
 *
 * Why this exists: Swift uses Security framework's SecKey + JWK serialisation
 * in DIDService.swift. The TS port keeps the same wire format so DIDs minted
 * on either platform resolve to the same key material.
 */
import { p256 } from '@noble/curves/nist.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { base64UrlDecode, base64UrlEncode } from '../crypto/base64';
import { publicKeyJwkSchema, type PublicKeyJWK } from '../types/jwk';

const COORD_LEN = 32; // P-256: 32-byte X + 32-byte Y

export interface P256KeyPair {
  /** 32-byte private scalar. */
  readonly privateKey: Uint8Array;
  /** 65-byte uncompressed point: 0x04 || X(32) || Y(32). */
  readonly publicKey: Uint8Array;
}

/** Generate a fresh P-256 keypair via OS RNG. */
export function generateP256KeyPair(): P256KeyPair {
  const privateKey = p256.utils.randomSecretKey(randomBytes(32));
  const publicKey = p256.getPublicKey(privateKey, false);
  return { privateKey, publicKey };
}

/** Derive the uncompressed public-key point from a raw private scalar. */
export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, false);
}

/** Compressed point (33 bytes: 0x02|0x03 || X) — used by did:key multicodec. */
export function compressPublicKey(uncompressed: Uint8Array): Uint8Array {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new Error('expected 65-byte uncompressed P-256 point');
  }
  return p256.Point.fromBytes(uncompressed).toBytes(true);
}

/** Convert an uncompressed public-key point to a JWK (P-256 / ES256). */
export function publicKeyToJwk(uncompressed: Uint8Array): PublicKeyJWK {
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new Error('expected 65-byte uncompressed P-256 point');
  }
  return publicKeyJwkSchema.parse({
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    x: base64UrlEncode(uncompressed.subarray(1, 1 + COORD_LEN)),
    y: base64UrlEncode(uncompressed.subarray(1 + COORD_LEN)),
  });
}

/** Reconstruct an uncompressed P-256 point from a JWK. */
export function jwkToPublicKey(jwk: PublicKeyJWK): Uint8Array {
  const x = base64UrlDecode(jwk.x);
  const y = base64UrlDecode(jwk.y);
  if (x.length !== COORD_LEN || y.length !== COORD_LEN) {
    throw new Error('JWK x/y must each be 32 bytes (base64url)');
  }
  const out = new Uint8Array(1 + COORD_LEN * 2);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 1 + COORD_LEN);
  return out;
}
