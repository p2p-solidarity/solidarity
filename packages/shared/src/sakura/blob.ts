/**
 * Sakura blob crypto — sealed payload for the messaging relay.
 *
 * Wire layout (the bytes that become `SendRequest.blob` after base64):
 *   [0..32)   ephemeral X25519 public key  (sender-generated, single-use)
 *   [32..44)  AES-GCM nonce                 (12 bytes, random)
 *   [44..)    AES-256-GCM(ct + tag)         (variable, includes auth tag)
 *
 * Why ECIES over a static AES key:
 *   - Sender doesn't need any long-term key with the recipient — pure ECDH.
 *   - Forward secrecy: every message uses a fresh ephemeral keypair, so
 *     compromise of the recipient's long-term X25519 priv decrypts past
 *     messages but not future ones (until the next key rotation).
 *   - Matches the Swift MessageService blob shape exactly so existing
 *     ciphertext from iOS can be opened here without migration.
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { aesGcmOpen, aesGcmSeal } from '../crypto/aesGcm';
import { utf8ToBytes } from '../crypto/base64';
import { deriveKey } from '../crypto/hkdf';

const PUB_LEN = 32;
const NONCE_LEN = 12;
const KEY_LEN = 32;

const HKDF_SALT = utf8ToBytes('gg.solidarity.sakura.salt.v1');
const HKDF_INFO = utf8ToBytes('sakura.blob.v1');

/** Generate a fresh X25519 recipient keypair (for inbox owner registration). */
export function generateRecipientKeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** Encrypt `payload` so only the holder of `recipientPublicKey`'s priv can read. */
export function sealBlob(
  recipientPublicKey: Uint8Array,
  payload: Uint8Array
): Uint8Array {
  if (recipientPublicKey.length !== PUB_LEN) {
    throw new Error(`recipient pubkey must be ${PUB_LEN} bytes`);
  }
  const ephemPriv = x25519.utils.randomSecretKey();
  const ephemPub = x25519.getPublicKey(ephemPriv);
  const shared = x25519.getSharedSecret(ephemPriv, recipientPublicKey);
  const key = deriveKey(shared, HKDF_SALT, HKDF_INFO, KEY_LEN);
  const nonce = randomBytes(NONCE_LEN);
  const ctWithTag = aesGcmSeal(key, payload, nonce);
  // aesGcmSeal returns nonce||ct||tag; strip the nonce since we encode it
  // separately to match the Swift layout (ephemPub || nonce || ct||tag).
  const ctOnly = ctWithTag.subarray(NONCE_LEN);

  const out = new Uint8Array(PUB_LEN + NONCE_LEN + ctOnly.length);
  out.set(ephemPub, 0);
  out.set(nonce, PUB_LEN);
  out.set(ctOnly, PUB_LEN + NONCE_LEN);
  return out;
}

/** Decrypt a blob produced by `sealBlob` with our long-term X25519 private key. */
export function openBlob(
  recipientPrivateKey: Uint8Array,
  blob: Uint8Array
): Uint8Array {
  if (recipientPrivateKey.length !== KEY_LEN) {
    throw new Error(`recipient privkey must be ${KEY_LEN} bytes`);
  }
  if (blob.length < PUB_LEN + NONCE_LEN + 16) {
    throw new Error('sakura blob too short for ECIES + AES-GCM');
  }
  const ephemPub = blob.subarray(0, PUB_LEN);
  const nonce = blob.subarray(PUB_LEN, PUB_LEN + NONCE_LEN);
  const ctOnly = blob.subarray(PUB_LEN + NONCE_LEN);

  const shared = x25519.getSharedSecret(recipientPrivateKey, ephemPub);
  const key = deriveKey(shared, HKDF_SALT, HKDF_INFO, KEY_LEN);

  // Re-assemble nonce||ct||tag for aesGcmOpen.
  const combined = new Uint8Array(NONCE_LEN + ctOnly.length);
  combined.set(nonce, 0);
  combined.set(ctOnly, NONCE_LEN);
  return aesGcmOpen(key, combined);
}
