/**
 * Sakura recipient keys — long-term keypair for the messaging relay.
 *
 * Two key materials per install (mirrors Swift `SecureKeyManager`):
 *   1. X25519 encryption keypair — public key registered with the relay as
 *      the holder's `recipient_pubkey`; private key opens every inbox blob
 *      (`openBlob`). Wire-compatible with the Swift Curve25519 KeyAgreement
 *      path — same 32-byte raw representation for both halves.
 *   2. Ed25519 signing keypair — used to EdDSA-sign every outbound
 *      `SendRequest` (`sender_sig`). The relay verifies the signature
 *      against `sender_pubkey` before forwarding, so the recipient can
 *      trust the envelope wasn't tampered with mid-flight.
 *
 *      Now matches Swift Ed25519 exactly. The Swift side uses
 *      `Curve25519.Signing.PrivateKey` (CryptoKit) — see
 *      `SecureKeyManager.swift` line 9 + `sign(content:)` lines 87-93:
 *      `signingKey.signature(for: contentString.data(using: .utf8))` →
 *      `signature.base64EncodedString()` (standard padded base64). The 32-byte
 *      raw public-key representation is base64-encoded as `mySignPubKey`
 *      (line 79). Ed25519 signs the raw UTF-8 bytes directly; there is no
 *      SHA-256 prehash (EdDSA does its own internal SHA-512 over the message
 *      + nonce). Wire result: 64-byte signature, 32-byte public key, both
 *      standard base64. Relay verifies Ed25519 sigs against `sender_pubkey`.
 *
 * Storage:
 *   Both private keys live in `expo-secure-store`, base64-encoded, behind
 *   `requireAuthentication: true` (BIOMETRY_CURRENT_SET on iOS; biometric
 *   on Android — falls back to device passcode through the system prompt).
 *   Public keys are cached in module-scope after first read so subsequent
 *   QR-card renders don't trigger a biometric prompt on every paint.
 *
 *   The signing-key alias was bumped to `sig.ed25519.v1` so the old P-256
 *   blob (`sig.v1`) is never accidentally interpreted as an Ed25519 seed —
 *   they're both 32 bytes but the curves are incompatible.
 */
import * as SecureStore from 'expo-secure-store';

import {
  base64Decode,
  base64Encode,
  generateRecipientKeyPair,
  utf8ToBytes,
} from '@solidarity/shared';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

const ENC_PRIV_ALIAS = 'gg.solidarity.sakura.enc.v1';
const SIG_PRIV_ALIAS = 'gg.solidarity.sakura.sig.ed25519.v1';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your Sakura messaging keys',
};

const PRIV_LEN = 32;

/**
 * Long-term Sakura recipient keypair. Private bytes never leave the module —
 * callers receive only the public material plus opaque signing/opening
 * helpers (see `signSendRequest` + `decryptInboxBlob`).
 */
export interface RecipientKeyPair {
  /** Raw 32-byte X25519 public key (registered with the relay). */
  readonly encryptionPub: Uint8Array;
  /** Base64 of `encryptionPub` — matches Swift `mySealedRoute` JSON shape. */
  readonly encryptionPubBase64: string;
  /** Raw 32-byte Ed25519 public key (matches Swift `mySignPubKey`). */
  readonly signingPub: Uint8Array;
  /** Base64 of `signingPub` — used as `SendRequest.sender_pubkey`. */
  readonly signingPubBase64: string;
}

interface CachedSecrets {
  readonly encPriv: Uint8Array;
  readonly sigPriv: Uint8Array;
  readonly pair: RecipientKeyPair;
}

let cached: CachedSecrets | null = null;

async function readBytes(alias: string): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(alias, SECURE_OPTS).catch(() => null);
  return stored ? base64Decode(stored) : null;
}

async function writeBytes(alias: string, bytes: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(alias, base64Encode(bytes), SECURE_OPTS);
}

function buildPair(encPriv: Uint8Array, sigPriv: Uint8Array): RecipientKeyPair {
  // X25519 + Ed25519 public keys are deterministically derived from the
  // 32-byte private seed. Both halves go through noble so the wire matches
  // Swift CryptoKit's `Curve25519.{KeyAgreement,Signing}.PrivateKey
  // .publicKey.rawRepresentation` byte-for-byte (32 raw bytes each).
  const encryptionPub = x25519.getPublicKey(encPriv);
  const signingPub = ed25519.getPublicKey(sigPriv);
  return {
    encryptionPub,
    encryptionPubBase64: base64Encode(encryptionPub),
    signingPub,
    signingPubBase64: base64Encode(signingPub),
  };
}

async function provisionFreshKeys(): Promise<{ encPriv: Uint8Array; sigPriv: Uint8Array }> {
  const enc = generateRecipientKeyPair();
  const sigPriv = ed25519.utils.randomSecretKey();
  await writeBytes(ENC_PRIV_ALIAS, enc.privateKey);
  await writeBytes(SIG_PRIV_ALIAS, sigPriv);
  return { encPriv: enc.privateKey, sigPriv };
}

/**
 * Get (or lazily generate) the holder's long-term Sakura keypair. The first
 * call mints two fresh keys and persists them; subsequent calls return the
 * cached pair without prompting biometric again (the cache lives for the
 * lifetime of the JS context, mirroring `SecureKeyManager.shared`).
 */
export async function loadOrCreateRecipientKeys(): Promise<RecipientKeyPair> {
  if (cached) return cached.pair;

  const encPrivStored = await readBytes(ENC_PRIV_ALIAS);
  const sigPrivStored = await readBytes(SIG_PRIV_ALIAS);

  let encPriv: Uint8Array;
  let sigPriv: Uint8Array;
  if (encPrivStored && sigPrivStored) {
    if (encPrivStored.length !== PRIV_LEN || sigPrivStored.length !== PRIV_LEN) {
      throw new Error('Sakura recipient key on disk has unexpected length');
    }
    encPriv = encPrivStored;
    sigPriv = sigPrivStored;
  } else {
    // Either alias missing — treat as fresh install (or post-wipe). We
    // re-provision both halves together so the pair is always consistent.
    const fresh = await provisionFreshKeys();
    encPriv = fresh.encPriv;
    sigPriv = fresh.sigPriv;
  }

  const pair = buildPair(encPriv, sigPriv);
  cached = { encPriv, sigPriv, pair };
  return pair;
}

/**
 * Open a sealed inbox blob with the holder's long-term X25519 private key.
 * Loads the keys on first call. Throws if the user denies biometric.
 */
export async function decryptInboxBlob(
  blob: Uint8Array,
  open: (priv: Uint8Array, blob: Uint8Array) => Uint8Array
): Promise<Uint8Array> {
  await loadOrCreateRecipientKeys();
  if (!cached) throw new Error('recipient keys not loaded');
  return open(cached.encPriv, blob);
}

/**
 * Internal — exposes the private key bytes to sibling modules in the
 * `src/sakura/` package (currently only `inbox.ts`). The accessor is
 * deliberately not named on the public type because the secrets must never
 * cross out of this folder; we keep it in module scope rather than as a
 * separate private file because of the cache lifecycle interplay.
 *
 * Returns `null` if `loadOrCreateRecipientKeys` hasn't been called yet.
 */
export function __getRecipientSecretsForInbox(): {
  readonly encPriv: Uint8Array;
  readonly sigPriv: Uint8Array;
} | null {
  if (!cached) return null;
  return { encPriv: cached.encPriv, sigPriv: cached.sigPriv };
}

/**
 * Ed25519-sign the canonical `SendRequest` payload (recipient_pubkey + blob +
 * sealed_route) and return the standard padded base64 of the 64-byte EdDSA
 * signature. This is the helper `client.ts` refers to as `signSendRequest`;
 * we expose it here because the private key lives next to the rest of the
 * recipient material.
 *
 * The canonical string format matches Swift `MessageService.sendMessage`
 * (lines 65-67) byte-for-byte:
 *   `{"recipient_pubkey":"<x>","blob":"<y>","sealed_route":"<z>"}`
 * No whitespace, fixed key order (`recipient_pubkey`, `blob`, `sealed_route`),
 * values are the same base64 strings both platforms put on the wire. Swift
 * then hands the UTF-8 bytes straight to `Curve25519.Signing.PrivateKey
 * .signature(for:)` — no separate hashing step (EdDSA already does its own
 * SHA-512 internally). We do the same here so signatures verify on either
 * platform's relay code path.
 */
export async function signSendRequest(input: {
  recipientPubkey: string;
  blob: string;
  sealedRoute: string;
}): Promise<string> {
  await loadOrCreateRecipientKeys();
  if (!cached) throw new Error('recipient keys not loaded');
  const canonical = `{"recipient_pubkey":"${input.recipientPubkey}","blob":"${input.blob}","sealed_route":"${input.sealedRoute}"}`;
  const sigBytes = ed25519.sign(utf8ToBytes(canonical), cached.sigPriv);
  return base64Encode(sigBytes);
}

/**
 * Test-only — drops the in-memory cache + persisted aliases so subsequent
 * `loadOrCreateRecipientKeys` calls re-provision fresh keys.
 */
export async function resetRecipientKeysForTesting(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(ENC_PRIV_ALIAS, SECURE_OPTS).catch(
    () => undefined
  );
  await SecureStore.deleteItemAsync(SIG_PRIV_ALIAS, SECURE_OPTS).catch(
    () => undefined
  );
}
