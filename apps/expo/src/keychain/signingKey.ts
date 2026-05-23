/**
 * Identity signing key — mirrors KeychainService.swift's
 * `ensureSigningKey()` + `sign(_:)`.
 *
 * Storage:
 *   iOS    : expo-secure-store → Keychain item with `requireAuthentication: true`
 *            (kSecAttrAccessControl + .userPresence). Each `sign()` prompts
 *            Face ID/Touch ID.
 *   Android: expo-secure-store → EncryptedSharedPreferences via Keystore.
 *            Biometric gate enforced explicitly via `requireBiometric()`
 *            because Android Keystore biometry semantics differ.
 *
 * The private key bytes never leave this module; sign() returns a raw
 * `r||s` ECDSA signature. JWT signing in @solidarity/shared/identity/jwt.ts
 * composes the header/payload and calls into here.
 */
import * as SecureStore from 'expo-secure-store';

import {
  base64Decode,
  base64Encode,
  generateP256KeyPair,
  type P256KeyPair,
  publicKeyFromPrivate,
  publicKeyToJwk,
  type PublicKeyJWK,
  signJwtEs256,
} from '@solidarity/shared';

import { requireBiometric } from './biometric';

const SIGNING_KEY_ALIAS = 'gg.solidarity.signing.v2';
const LEGACY_ALIAS = 'kidneyweakx.airmeishi.signingKey';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your identity key',
};

async function readPrivateKey(alias: string): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(alias, SECURE_OPTS);
  return stored ? base64Decode(stored) : null;
}

async function writePrivateKey(alias: string, bytes: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(alias, base64Encode(bytes), SECURE_OPTS);
}

/**
 * Get (or lazily create) the user's P-256 signing keypair. Performs the
 * legacy-alias migration so users upgrading from the Swift build keep their
 * existing DID instead of being assigned a new one.
 */
export async function ensureSigningKey(): Promise<P256KeyPair> {
  const existing = await readPrivateKey(SIGNING_KEY_ALIAS);
  if (existing) {
    return { privateKey: existing, publicKey: publicKeyFromPrivate(existing) };
  }

  const legacy = await readPrivateKey(LEGACY_ALIAS);
  if (legacy) {
    await writePrivateKey(SIGNING_KEY_ALIAS, legacy);
    return { privateKey: legacy, publicKey: publicKeyFromPrivate(legacy) };
  }

  const fresh = generateP256KeyPair();
  await writePrivateKey(SIGNING_KEY_ALIAS, fresh.privateKey);
  return fresh;
}

/** Public-key JWK of the active signing key, for DID derivation or VC publishing. */
export async function publicJwk(): Promise<PublicKeyJWK> {
  const kp = await ensureSigningKey();
  return publicKeyToJwk(kp.publicKey);
}

/** Sign a JWT (header + payload) with the active signing key, biometric-gated. */
export async function signJwt(
  header: { alg: 'ES256'; typ?: string; kid?: string },
  payload: Readonly<Record<string, unknown>>
): Promise<string> {
  const allowed = await requireBiometric('sign');
  if (!allowed) throw new Error('biometric authentication required');
  const kp = await ensureSigningKey();
  return signJwtEs256(header, payload, kp.privateKey);
}

/** Test-only — wipes both v2 and legacy aliases. */
export async function resetSigningKeyForTesting(): Promise<void> {
  await SecureStore.deleteItemAsync(SIGNING_KEY_ALIAS, SECURE_OPTS);
  await SecureStore.deleteItemAsync(LEGACY_ALIAS, SECURE_OPTS);
}
