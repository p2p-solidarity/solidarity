/**
 * did:key (P-256) — mirrors DIDService.swift / DIDKeyResolver.swift.
 *
 * Wire format (W3C did:key spec, P-256 variant):
 *   did:key:z<base58btc( 0x80 0x24 || compressed_pubkey_33_bytes )>
 *
 * Multicodec prefix 0x1200 = P-256 public key, encoded as varint = 0x80 0x24.
 *
 * Round-trip parity: a DID minted by Swift KeychainService resolves to the
 * same JWK as TS `resolveDidKey(...)`. Verified by
 * apps/expo/__tests__/parity/didKey.parity.test.ts.
 */
import { base58 } from '@scure/base';

import {
  compressPublicKey,
  jwkToPublicKey,
  publicKeyToJwk,
} from './keyPair';
import { p256 } from '@noble/curves/nist.js';
import type { PublicKeyJWK } from '../types/jwk';

/** Multicodec varint for P-256 public key (0x1200 → 0x80, 0x24). */
const P256_MULTICODEC = new Uint8Array([0x80, 0x24]);

/** Multibase prefix `z` = base58btc. */
const MULTIBASE_BASE58BTC = 'z';

const DID_KEY_PREFIX = 'did:key:';

/** Derive `did:key:z…` from an uncompressed P-256 public-key point. */
export function didKeyFromPublicKey(uncompressedPoint: Uint8Array): string {
  const compressed = compressPublicKey(uncompressedPoint);
  const bytes = new Uint8Array(P256_MULTICODEC.length + compressed.length);
  bytes.set(P256_MULTICODEC, 0);
  bytes.set(compressed, P256_MULTICODEC.length);
  return `${DID_KEY_PREFIX}${MULTIBASE_BASE58BTC}${base58.encode(bytes)}`;
}

/** Convenience: derive `did:key` from a JWK. */
export function didKeyFromJwk(jwk: PublicKeyJWK): string {
  return didKeyFromPublicKey(jwkToPublicKey(jwk));
}

/**
 * Resolve a `did:key:z…` back to its JWK. Throws on:
 *   - missing `did:key:` prefix
 *   - missing multibase `z` prefix (only base58btc supported)
 *   - wrong multicodec prefix (only P-256 supported)
 *   - invalid compressed point
 */
export function resolveDidKey(did: string): PublicKeyJWK {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`not a did:key: ${did}`);
  }
  const body = did.slice(DID_KEY_PREFIX.length);
  if (!body.startsWith(MULTIBASE_BASE58BTC)) {
    throw new Error(`did:key must use multibase 'z' (base58btc): ${did}`);
  }
  const decoded = base58.decode(body.slice(MULTIBASE_BASE58BTC.length));
  if (
    decoded.length < P256_MULTICODEC.length + 33 ||
    decoded[0] !== P256_MULTICODEC[0] ||
    decoded[1] !== P256_MULTICODEC[1]
  ) {
    throw new Error('did:key is not a P-256 multicodec');
  }
  const compressed = decoded.subarray(P256_MULTICODEC.length);
  const uncompressed = p256.Point.fromBytes(compressed).toBytes(false);
  return publicKeyToJwk(uncompressed);
}
