/**
 * Nitro spec — semaphore
 *
 * Wraps the Rust `semaphore_bindings` crate (semaphore-rs uniffi bindings)
 * for on-device Semaphore identity + membership proofs. Mirrors the Swift
 * FFI surface used by `solidarity/Services/ZK/SemaphoreIdentityManager.swift`
 * + `SemaphoreGroupManager.swift` + `NullifierStore.swift` so the Expo
 * client produces byte-identical commitments / proof envelopes as the
 * legacy SwiftUI app.
 *
 * iOS  : HybridSemaphore.swift -> SemaphoreShim.swift -> MoproBindings.xcframework
 *        (the same xcframework used by passport-zk; libsemaphore_bindings.a
 *        slice is what we link).
 * Android: HybridSemaphore.kt -> uniffi-generated Kotlin -> libuniffi_semaphore_bindings.so
 *
 * Field-element encoding (kept byte-identical to Swift — see
 * SemaphoreIdentityManager.swift:427-453):
 *   commitments are DECIMAL-STRING field elements (BN254 scalar field).
 *   `commitmentElement(from:)` parses the decimal scalar into a 32-byte
 *   little-endian Data buffer that the Rust binding expects.
 *
 * Replay protection (`hasNullifier` / `recordNullifier`) is sync because
 * the iOS Keychain (and Android EncryptedSharedPreferences) are both
 * blocking + main-thread safe for short reads/writes. The Swift impl
 * (`NullifierStore.swift`) is also fully sync.
 *
 * NOTE: this file lives on the JS↔Native boundary, so `any` is allowed by
 * eslint config (see eslint.config.mjs override on
 * `nitro-modules / src / specs`).
 */
import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Decoded form of a Semaphore proof. The raw JSON the Rust binding produces
 * is the source of truth — we surface its fields plus the binding-context
 * envelope (scope, signal, group root) that the legacy Swift app pins on
 * top so verification can detect outer/inner disagreement.
 */
export interface SemaphoreProof {
  /** Nullifier hash as a decimal-string field element. Replay-key. */
  readonly nullifier: string;
  /** Merkle root the proof was generated against (decimal-string field element). */
  readonly merkleRoot: string;
  /** Application-defined scope (clamped to 32 UTF-8 bytes, mirrors Swift). */
  readonly scope: string;
  /** Application-defined signal/message (clamped to 32 UTF-8 bytes). */
  readonly signal: string;
  /**
   * The raw proof JSON produced by `semaphore_bindings::generateSemaphoreProof`.
   * Treated as opaque on the JS side — used for `verifyProof` and to
   * forward verbatim to relying parties.
   */
  readonly proofJson: string;
  /**
   * The Merkle-tree depth the proof was generated at (1..=32 in semaphore-rs;
   * the iOS Swift caller default is 16).
   */
  readonly merkleTreeDepth: number;
}

export interface Semaphore
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Generate a fresh identity from cryptographically-secure random bytes
   * and persist it to native secure storage (iOS Keychain /
   * Android EncryptedSharedPreferences). Returns the public commitment
   * (decimal-string field element).
   */
  generateIdentity(): Promise<string>;

  /**
   * Deterministic identity from a 32-byte seed (used in tests + for
   * parity fixtures). Persists the resulting identity.
   */
  identityFromSeed(seed: ArrayBuffer): Promise<string>;

  /** Returns the cached commitment for the currently loaded identity, or "". */
  getCommitment(): string;

  /**
   * Try to load an identity from native secure storage under the given alias.
   * Returns false when no entry exists (caller should call generateIdentity()).
   */
  loadIdentityFromKeychain(alias: string): Promise<boolean>;

  /** Persist the currently loaded identity under the given alias. */
  storeIdentityToKeychain(alias: string): Promise<void>;

  /** Delete the identity from secure storage AND clear the in-memory cache. */
  deleteIdentity(): Promise<void>;

  /**
   * Export the raw 32-byte private key so the caller can stash it in the
   * encrypted iCloud / Drive backup blob. Biometric gating is the caller's
   * responsibility (the JS wrapper calls `requireBiometric` before this).
   */
  exportPrivateKey(): Promise<ArrayBuffer>;

  /**
   * Import a previously-exported private key (or one derived in another
   * process) and persist as the active identity. Returns the resulting
   * commitment.
   */
  importPrivateKey(bytes: ArrayBuffer): Promise<string>;

  /**
   * Compute the Semaphore-circuit group root for the given commitments
   * (decimal-string field elements). Mirrors
   * `SemaphoreIdentityManager.circuitGroupRoot(for:)`. The commitments
   * are canonicalised (trim, dedupe, sort) before being fed to the Rust
   * `Group::root` so two devices with the same member set always derive
   * the same root.
   */
  groupRootFromCommitments(commitments: string[]): Promise<string>;

  /**
   * Generate a Semaphore proof that the currently-loaded identity is a
   * member of the group whose commitments are passed in. Throws if the
   * caller's own commitment isn't in the set (mirrors Swift).
   */
  generateProof(
    commitments: string[],
    scope: string,
    signal: string
  ): Promise<SemaphoreProof>;

  /** Verify a previously-generated proof at the given Merkle-tree depth. */
  verifyProof(proof: SemaphoreProof, merkleTreeDepth: number): Promise<boolean>;

  /** Read the nullifier hash off a proof (convenience accessor). */
  extractNullifier(proof: SemaphoreProof): string;

  /**
   * Replay protection — sync. Native backs this with the iOS Keychain
   * (`solidarity.zk.nullifiers`) / Android EncryptedSharedPreferences
   * so a `(scope, nullifier)` pair survives app upgrades + reinstalls.
   */
  hasNullifier(scope: string, nullifier: string): boolean;

  /** Atomically record `(scope, nullifier)` after a successful verification. */
  recordNullifier(scope: string, nullifier: string): void;
}
