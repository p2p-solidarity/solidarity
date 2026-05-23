/**
 * Pairwise per-RP signing keys — mirrors KeychainService.swift's
 * `ensurePairwiseKey(forDomain:)` / `pairwisePublicJwk(forDomain:)`.
 *
 * Why pairwise: presenting the same DID to every verifier links the user
 * across services. Per RP domain we derive a deterministic sub-key from the
 * master signing key via HKDF, namespaced by the verifier's origin. The RP
 * sees a unique JWK / did:key per relationship; the user keeps a single
 * Keychain-protected master.
 *
 * Deterministic derivation (vs storing N keys) is intentional: it survives
 * device migration with zero extra bookkeeping and matches the Swift
 * approach so a peer who already knows the user's pairwise DID continues
 * to see the same DID after the user reinstalls the app.
 */
import {
  deriveKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  sha256Bytes,
  type PublicKeyJWK,
  utf8ToBytes,
} from '@solidarity/shared';

import { ensureSigningKey } from './signingKey';

const PAIRWISE_INFO_PREFIX = 'solidarity.pairwise.v1:';
const PAIRWISE_SALT = utf8ToBytes('gg.solidarity.pairwise.salt.v1');

function pairwiseSeed(domain: string): Uint8Array {
  // Hash the domain so the HKDF info string is fixed-length and free of
  // ambiguous separators (e.g. "example.com/" vs "example.com").
  const tagged = `${PAIRWISE_INFO_PREFIX}${domain.toLowerCase()}`;
  return sha256Bytes(tagged);
}

/** Derive a P-256 private scalar for `domain`. Pure function — no Keychain writes. */
export async function pairwisePrivateKey(domain: string): Promise<Uint8Array> {
  const master = await ensureSigningKey();
  const info = pairwiseSeed(domain);
  // HKDF outputs 32 bytes; P-256 valid scalar range is [1, n-1]. With overwhelming
  // probability the output is in range; reject + reroll on the vanishingly rare
  // out-of-range case (matches CryptoKit's `P256.Signing.PrivateKey(rawRepresentation:)`).
  const derived = deriveKey(master.privateKey, PAIRWISE_SALT, info, 32);
  if (derived.every((b) => b === 0)) {
    throw new Error('HKDF derived zero scalar — pick a different domain');
  }
  return derived;
}

/** JWK published to the RP — derives from the pairwise private key on demand. */
export async function pairwisePublicJwk(domain: string): Promise<PublicKeyJWK> {
  const priv = await pairwisePrivateKey(domain);
  return publicKeyToJwk(publicKeyFromPrivate(priv));
}
