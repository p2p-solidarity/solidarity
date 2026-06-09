/**
 * Nitro spec — secrets-vault (hardware-backed root-secret wrapping)
 *
 * Mirrors the Swift contract in
 *   solidarity/Services/Vault/VaultSecretsKeychain.swift
 * by exposing a wrap/unwrap surface over a wrapping key that lives inside
 * the Secure Enclave (iOS) or StrongBox / TEE (Android). The raw 32-byte
 * AES root never leaves the secure element after wrap returns.
 *
 *   iOS    : HybridSecretsVault.swift uses
 *            `SecureEnclave.P256.KeyAgreement.PrivateKey` for the wrapping
 *            key. Each `wrap()` call generates an ephemeral P-256 keypair,
 *            performs ECDH against the SE key, derives an AES-256-GCM key
 *            via HKDF-SHA256, and seals the plaintext. The wrapped blob
 *            shape is: `ephemeralPubKey(65B X9.63) || nonce(12B) || ct ||
 *            tag(16B)` (i.e. HPKE-flavoured ECIES).
 *   Android: HybridSecretsVault.kt uses AndroidKeystore AES-256-GCM with
 *            `setIsStrongBoxBacked(true)` when available, falling back to
 *            TEE on devices without StrongBox. The wrapped blob shape is:
 *            `nonce(12B) || ct || tag(16B)`.
 *
 * The `algorithm` discriminator on `WrappedSecret` lets the TS layer pin
 * the format it's looking at without parsing — useful for future migrations
 * when a new wrapping scheme rolls in alongside the old one.
 *
 * Nested object types are extracted to top-level interfaces because
 * Nitrogen rejects anonymous inline structs (it can't codegen the C++).
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface WrappedSecret {
  /** Algorithm: 'aes-gcm-secure-enclave-ecies' (iOS) or 'aes-gcm-strongbox' (Android). */
  readonly algorithm: string;
  /** The wrapping key handle / alias (the actual private key never leaves the secure element). */
  readonly keyAlias: string;
  /** Wrapped ciphertext bytes (HPKE-ish: ephemeral pubkey || nonce || ciphertext || tag). */
  readonly wrapped: ArrayBuffer;
  /** Whether StrongBox / Secure Enclave was used (true) vs TEE / software fallback (false). */
  readonly hardwareBacked: boolean;
}

export interface EnsureWrappingKeyResult {
  /** Whether the wrapping key landed in Secure Enclave / StrongBox (true) vs TEE / software (false). */
  readonly hardwareBacked: boolean;
}

export interface SecretsVault
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /** Quick probe — does this device support hardware-backed key wrapping at all? */
  isHardwareAvailable(): boolean;
  /**
   * Generate or fetch a wrapping key under the given alias. Idempotent:
   * a second call with the same alias is a no-op that returns the existing
   * key's `hardwareBacked` flag.
   */
  ensureWrappingKey(
    keyAlias: string,
    requireBiometric: boolean
  ): Promise<EnsureWrappingKeyResult>;
  /** Wrap `plaintext` with the wrapping key bound to `keyAlias`. */
  wrap(keyAlias: string, plaintext: ArrayBuffer): Promise<WrappedSecret>;
  /** Unwrap a previously-wrapped blob. Throws on tag mismatch / wrong alias. */
  unwrap(wrapped: WrappedSecret): Promise<ArrayBuffer>;
  /** Delete the wrapping key. The wrapped blob becomes permanently unrecoverable. */
  deleteKey(keyAlias: string): Promise<void>;
  /**
   * iOS-only legacy migration helper. Reads a raw generic-password Keychain
   * item addressed by `(service, account)` and returns its bytes. Returns an
   * empty buffer when the item is missing or the platform has no matching
   * legacy Keychain store.
   */
  readRawKeychainGenericPassword(
    service: string,
    account: string
  ): Promise<ArrayBuffer>;
}
