/**
 * ContentKeyExchange — TS port of
 * solidarity/Services/Vault/ContentKeyExchangeService.swift's content-key
 * wrap/unwrap envelope used to ferry an item's symmetric content key
 * between paired devices.
 *
 * Wire layout (mirrors the Swift envelope so iOS-produced ciphertexts
 * open in Expo and vice versa):
 *   [0..32)   sender X25519 public key (single-use ephemeral, generated
 *             per wrap call)
 *   [32..44)  AES-GCM nonce (12 bytes)
 *   [44..)    AES-256-GCM(content key || tag)
 *
 * The shared secret is derived via X25519 ECDH; the symmetric key is
 * HKDF-SHA256 over the shared secret with domain-separated salt + info
 * so reusing the recipient long-term key for sakura messaging produces a
 * different AES key here (no cross-protocol confusion).
 */
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';

import {
  aesGcmOpen,
  aesGcmSeal,
  deriveKey,
  err,
  ok,
  utf8ToBytes,
  type CardError,
  type Result,
} from '@solidarity/shared';

export type CryptoError = CardError;

const PUB_LEN = 32;
const NONCE_LEN = 12;
const KEY_LEN = 32;
const TAG_LEN = 16;
const HEADER_LEN = PUB_LEN + NONCE_LEN;

const HKDF_SALT = utf8ToBytes('gg.solidarity.vault.contentKeyExchange.salt.v1');
const HKDF_INFO = utf8ToBytes('vault.contentKeyExchange.v1');

function deriveSharedKey(sharedSecret: Uint8Array): Uint8Array {
  return deriveKey(sharedSecret, HKDF_SALT, HKDF_INFO, KEY_LEN);
}

export async function wrapKeyForPeer(opts: {
  readonly contentKey: Uint8Array;
  readonly peerPubKey: Uint8Array;
}): Promise<Uint8Array> {
  if (opts.peerPubKey.length !== PUB_LEN) {
    throw new Error(`peer pubkey must be ${String(PUB_LEN)} bytes`);
  }
  const ephemPriv = x25519.utils.randomSecretKey();
  const ephemPub = x25519.getPublicKey(ephemPriv);
  const shared = x25519.getSharedSecret(ephemPriv, opts.peerPubKey);
  const key = deriveSharedKey(shared);
  const nonce = randomBytes(NONCE_LEN);
  const ctWithTag = aesGcmSeal(key, opts.contentKey, nonce);
  const ctOnly = ctWithTag.subarray(NONCE_LEN);

  const out = new Uint8Array(HEADER_LEN + ctOnly.length);
  out.set(ephemPub, 0);
  out.set(nonce, PUB_LEN);
  out.set(ctOnly, HEADER_LEN);
  return out;
}

export async function unwrapKeyFromPeer(opts: {
  readonly wrapped: Uint8Array;
  readonly senderPubKey: Uint8Array;
}): Promise<Result<Uint8Array, CryptoError>> {
  if (opts.senderPubKey.length !== PUB_LEN) {
    return err<CryptoError>({
      type: 'cryptographicError',
      message: `senderPubKey must be ${String(PUB_LEN)} bytes`,
    });
  }
  if (opts.wrapped.length < HEADER_LEN + TAG_LEN) {
    return err<CryptoError>({
      type: 'cryptographicError',
      message: 'Wrapped content key envelope too short',
    });
  }
  const ephemPub = opts.wrapped.subarray(0, PUB_LEN);
  for (let i = 0; i < PUB_LEN; i++) {
    if (ephemPub[i] !== opts.senderPubKey[i]) {
      return err<CryptoError>({
        type: 'cryptographicError',
        message: 'Envelope sender public key mismatch',
      });
    }
  }
  try {
    const nonce = opts.wrapped.subarray(PUB_LEN, HEADER_LEN);
    const ctOnly = opts.wrapped.subarray(HEADER_LEN);
    const recipientPriv = await readRecipientPrivateKey();
    const shared = x25519.getSharedSecret(recipientPriv, ephemPub);
    const key = deriveSharedKey(shared);
    const combined = new Uint8Array(NONCE_LEN + ctOnly.length);
    combined.set(nonce, 0);
    combined.set(ctOnly, NONCE_LEN);
    return ok(aesGcmOpen(key, combined));
  } catch (error) {
    return err<CryptoError>({
      type: 'cryptographicError',
      message: `Content key unwrap failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

let recipientKeyProvider: (() => Promise<Uint8Array>) | null = null;

export function registerRecipientKeyProvider(provider: () => Promise<Uint8Array>): void {
  recipientKeyProvider = provider;
}

async function readRecipientPrivateKey(): Promise<Uint8Array> {
  if (!recipientKeyProvider) {
    throw new Error(
      'No recipient private key provider registered — call registerRecipientKeyProvider() during app boot'
    );
  }
  const bytes = await recipientKeyProvider();
  if (bytes.length !== KEY_LEN) {
    throw new Error(`recipient private key must be ${String(KEY_LEN)} bytes`);
  }
  return bytes;
}
