/**
 * Unified mnemonic derivation — the App/Web portability primitive (04-plan
 * Phase A1 amendment): the same BIP-39 mnemonic must derive the same
 * did:key on the Expo app and the future web viewer, so a user's identity
 * is carried by the mnemonic rather than being device-bound.
 *
 * Derivation rule (pinned — changing it breaks every existing identity;
 * `vectors/derive.json` freezes this exact behaviour for App<->Web
 * conformance testing):
 *
 *   seed   = bip39.mnemonicToSeedSync(mnemonic)              // no passphrase
 *   okm    = HKDF-SHA256(ikm = seed, salt = utf8('solidarity'), info, 48 bytes)
 *   scalar = (BE(okm) mod (n - 1)) + 1                        // n = curve order
 *
 * `info` is a fixed per-purpose label (`HKDF_INFO_ROOT` for the P-256
 * root/did:key identity, `HKDF_INFO_NOSTR` for the secp256k1 production
 * Nostr identity — see `apps/expo/src/nostr/userKey.ts`) so the two keys
 * never share material even though they come from the same mnemonic and
 * seed. The sandbox dev-key (`apps/expo/src/dag/devKey.ts`) is unrelated
 * to either label — it is randomly generated, never mnemonic-derived.
 *
 * The 48-byte (384-bit) OKM reduced modulo a ~256-bit curve order biases
 * the result by at most 2^-128 of the range — negligible, and avoids a
 * rejection-sampling loop (RFC 9380-style "hash to scalar" oversampling).
 * `+ 1` keeps the scalar in `[1, n-1]`: 0 is never a valid private key on
 * either curve.
 *
 * `mnemonicToSeedSync` does NOT validate a BIP-39 checksum by itself (per
 * BIP-39, seed derivation is defined for any word-list-conformant
 * sentence) — this module explicitly calls `validateMnemonic` first and
 * throws `RangeError` on failure, so a typo'd mnemonic can never silently
 * derive a *different but still-valid-looking* key.
 */
import { generateMnemonic as bip39GenerateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { p256 } from '@noble/curves/nist.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE, numberToBytesBE } from '@noble/curves/utils.js';

import { utf8ToBytes } from './crypto/base64';
import { deriveKey } from './crypto/hkdf';

/** HKDF info label for the P-256 root identity (did:key). */
export const HKDF_INFO_ROOT = 'solidarity-root-v1';
/** HKDF info label for the secp256k1 Nostr sandbox key. */
export const HKDF_INFO_NOSTR = 'solidarity-nostr-v1';
/**
 * HKDF info label for the Portable Backup Key — the AES-256 key that protects
 * cross-device Backup Archives (SOLB v2). Distinct from the two identity
 * labels above so the backup key shares no key material with the root/nostr
 * signing keys even though all three come from the same mnemonic + seed.
 */
export const HKDF_INFO_BACKUP = 'solidarity-backup-v1';

const HKDF_SALT = utf8ToBytes('solidarity');
/** OKM length before curve-order reduction — 384 bits, see module docstring. */
const SCALAR_OKM_LENGTH = 48;
const SCALAR_BYTE_LENGTH = 32;
/** 256-bit entropy -> 24-word English mnemonic. */
const MNEMONIC_STRENGTH_BITS = 256;

function deriveScalar(mnemonic: string, info: string, curveOrder: bigint): Uint8Array {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new RangeError('deriveScalar: invalid BIP-39 mnemonic (unknown word or bad checksum)');
  }
  const seed = mnemonicToSeedSync(mnemonic);
  const okm = deriveKey(seed, HKDF_SALT, info, SCALAR_OKM_LENGTH);
  const reduced = (bytesToNumberBE(okm) % (curveOrder - 1n)) + 1n;
  return numberToBytesBE(reduced, SCALAR_BYTE_LENGTH);
}

/** Derive a P-256 private scalar (root identity / did:key) from `mnemonic`. */
export function deriveP256Scalar(mnemonic: string, info: string): Uint8Array {
  return deriveScalar(mnemonic, info, p256.Point.Fn.ORDER);
}

/** Derive a secp256k1 private scalar (Nostr sandbox key) from `mnemonic`. */
export function deriveSecp256k1Scalar(mnemonic: string, info: string): Uint8Array {
  return deriveScalar(mnemonic, info, secp256k1.Point.Fn.ORDER);
}

/**
 * Derive the 32-byte **Portable Backup Key** from `mnemonic` — the
 * Recovery-Phrase-derived AES-256 key used ONLY to encrypt cross-device
 * Backup Archives (SOLB v2). It is deliberately SEPARATE from the device-local
 * Device Storage Key (`apps/expo/src/storage/secureMasterKey.ts`), which
 * protects MMKV + local records and never leaves the device (see
 * `docs/adr/0001-derive-portable-backup-key-from-recovery-phrase.md`).
 *
 * Unlike `deriveP256Scalar` / `deriveSecp256k1Scalar` this is a raw symmetric
 * key, so it does NOT reduce modulo a curve order — HKDF-SHA256 straight to 32
 * bytes. Same seed + salt as the identity derivations with a DISTINCT info
 * label (`HKDF_INFO_BACKUP`), and it validates the BIP-39 checksum first
 * (throws `RangeError`), matching the scalar derivations' contract so a
 * typo'd phrase can never silently produce a usable-looking key.
 */
export function deriveBackupKeyFromMnemonic(mnemonic: string): Uint8Array {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new RangeError(
      'deriveBackupKeyFromMnemonic: invalid BIP-39 mnemonic (unknown word or bad checksum)'
    );
  }
  const seed = mnemonicToSeedSync(mnemonic);
  return deriveKey(seed, HKDF_SALT, HKDF_INFO_BACKUP, SCALAR_BYTE_LENGTH);
}

/** Generate a fresh 24-word (256-bit) English BIP-39 mnemonic. */
export function generateMnemonic(): string {
  return bip39GenerateMnemonic(wordlist, MNEMONIC_STRENGTH_BITS);
}
