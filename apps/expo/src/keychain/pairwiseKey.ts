/**
 * Pairwise per-RP signing keys — mirrors KeychainService.swift's
 * `ensurePairwiseKey(forDomain:)` / `pairwisePublicJwk(forDomain:)`.
 *
 * Why pairwise: presenting the same DID to every verifier links the user
 * across services. Per RP domain we derive a deterministic sub-key from the
 * master pairwise seed via HKDF, namespaced by the verifier's origin. The RP
 * sees a unique JWK / did:key per relationship.
 *
 * Why a separate "pairwise seed" alias (not the master signing key):
 *   The master signing key lives in Secure Enclave / StrongBox and its raw
 *   bytes are **never** accessible from the host process — that is the whole
 *   point of hardware-backed keys. HKDF, however, needs the seed bytes.
 *   So we keep two storage slots:
 *     1. `solidarity.master.v2` — Secure Enclave EC key, signs identity JWS.
 *     2. `solidarity.pairwise.seed.v2` — 32 random bytes stored in
 *        expo-secure-store with biometric protection. Used solely as the HKDF
 *        master input for pairwise derivation.
 *   This matches what the Swift app does (its `ensurePairwiseKey` path also
 *   keeps a separate per-RP entry rather than touching the SE master) and
 *   keeps pairwise derivation deterministic across reinstalls + iCloud
 *   restores.
 *
 * Deterministic derivation (vs storing N keys) is intentional: it survives
 * device migration with zero extra bookkeeping and matches the Swift
 * approach so a peer who already knows the user's pairwise DID continues
 * to see the same DID after the user reinstalls the app.
 */
import * as SecureStore from 'expo-secure-store';

import {
  base64Decode,
  base64Encode,
  deriveKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  sha256Bytes,
  type PublicKeyJWK,
  utf8ToBytes,
} from '@solidarity/shared';

const PAIRWISE_INFO_PREFIX = 'solidarity.pairwise.v1:';
const PAIRWISE_SALT = utf8ToBytes('gg.solidarity.pairwise.salt.v1');
const PAIRWISE_SEED_ALIAS = 'solidarity.pairwise.seed.v2';
/** Legacy raw-bytes alias from the @noble/curves era. Migrated on first use. */
const LEGACY_MASTER_ALIAS = 'gg.solidarity.signing.v2';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your identity key',
};

let cachedSeed: Uint8Array | null = null;

/**
 * Cryptographically-secure random bytes for the pairwise seed.
 * Uses Web Crypto's `getRandomValues` which on React Native is provided by
 * `react-native-get-random-values` (already a dependency of `apps/expo`).
 */
function cryptoRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/**
 * Get (or lazily mint) the pairwise HKDF master seed. Migrates from the
 * legacy `@noble/curves` raw-key alias if present so existing pairwise
 * derivations remain stable.
 */
async function ensurePairwiseSeed(): Promise<Uint8Array> {
  if (cachedSeed) return cachedSeed;

  // Try the modern alias first.
  const stored = await SecureStore.getItemAsync(PAIRWISE_SEED_ALIAS, SECURE_OPTS).catch(
    () => null
  );
  if (stored) {
    cachedSeed = base64Decode(stored);
    return cachedSeed;
  }

  // Migration: if a v1 raw P-256 private key still exists in the legacy
  // alias, reuse its bytes as the pairwise seed. This way, users upgrading
  // from the @noble/curves era keep deriving the same pairwise DIDs they
  // had before, even though the master signing key itself has rotated into
  // Secure Enclave.
  const legacy = await SecureStore.getItemAsync(LEGACY_MASTER_ALIAS, SECURE_OPTS).catch(
    () => null
  );
  if (legacy) {
    const bytes = base64Decode(legacy);
    await SecureStore.setItemAsync(
      PAIRWISE_SEED_ALIAS,
      base64Encode(bytes),
      SECURE_OPTS
    );
    cachedSeed = bytes;
    return cachedSeed;
  }

  // Fresh install — mint a 32-byte seed.
  const fresh = cryptoRandomBytes(32);
  await SecureStore.setItemAsync(
    PAIRWISE_SEED_ALIAS,
    base64Encode(fresh),
    SECURE_OPTS
  );
  cachedSeed = fresh;
  return cachedSeed;
}

function pairwiseSeed(domain: string): Uint8Array {
  // Hash the domain so the HKDF info string is fixed-length and free of
  // ambiguous separators (e.g. "example.com/" vs "example.com").
  const tagged = `${PAIRWISE_INFO_PREFIX}${domain.toLowerCase()}`;
  return sha256Bytes(tagged);
}

/** Derive a P-256 private scalar for `domain`. Pure function — no Keychain writes. */
export async function pairwisePrivateKey(domain: string): Promise<Uint8Array> {
  const master = await ensurePairwiseSeed();
  const info = pairwiseSeed(domain);
  // HKDF outputs 32 bytes; P-256 valid scalar range is [1, n-1]. With overwhelming
  // probability the output is in range; reject + reroll on the vanishingly rare
  // out-of-range case (matches CryptoKit's `P256.Signing.PrivateKey(rawRepresentation:)`).
  const derived = deriveKey(master, PAIRWISE_SALT, info, 32);
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

/** Test-only — clears the cached seed so subsequent calls re-read SecureStore. */
export async function resetPairwiseSeedForTesting(): Promise<void> {
  cachedSeed = null;
  await SecureStore.deleteItemAsync(PAIRWISE_SEED_ALIAS, SECURE_OPTS).catch(() => {});
}
