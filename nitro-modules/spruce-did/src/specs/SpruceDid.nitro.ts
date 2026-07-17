/**
 * Nitro spec — hardware-backed DID signing keys
 *
 * (Historically "SpruceID DID": this module once wrapped SpruceID's mobile
 * SDK for DID derivation + JWS/VC verification. Those 5 methods had ZERO
 * production TS callers — did:key codec + verification live in pure TS at
 * `packages/shared` (`didKeyFromJwk` / `resolveDidKey` / `verifyJwtEs256`)
 * — so 1.3.3 S7a removed them together with the whole SpruceID SDK
 * dependency (iOS SPM `sprucekit-mobile`, Android Maven
 * `com.spruceid.mobile.sdk`). What remains is the hardware key-management
 * shell: generation, existence, auth-mode probe, deletion, public-JWK
 * export, ES256 JWS + raw-digest signing, and the key lifecycle event
 * stream. Inventory + rationale: docs/ref/notes-sprucekit-slim.md.)
 *
 * Hardware-backed keystores:
 *   iOS    : Secure Enclave (P-256) via Apple Security framework. Keys are
 *            stored as Keychain items keyed by `alias` and never leave the
 *            enclave; `sign()` requires biometric/passcode if the alias was
 *            generated with `requireBiometric: true`.
 *   Android: AndroidKeyStore (StrongBox-backed on Pixel 3+ and other devices
 *            with `KeyProperties.SECURITY_LEVEL_STRONGBOX`). Keys generated
 *            with `requireBiometric: true` enforce BiometricPrompt on every
 *            sign via `KeyGenParameterSpec.setUserAuthenticationRequired`.
 *
 * Why this replaces `@noble/curves`-backed key generation in
 * `packages/shared/src/identity/keyPair.ts`:
 *   - On React Native, `crypto.randomBytes()` falls back to non-CSPRNG
 *     entropy (Math.random style). The output is predictable enough that an
 *     attacker who knows the install time can brute-force it.
 *   - The user's signing key never being available to JS means it cannot be
 *     leaked by JSI bridge issues, hermes-snapshot extraction, or
 *     `__DEV__`-mode debugger inspection.
 *   - Forensically: a DID generated on a device proves "this device's
 *     enclave" — useful for OIDC4VC verifier trust models.
 *
 * Spec stability: the API surface here mirrors what `keychain/signingKey.ts`
 * exposes today (ensureSigningKey / publicJwk / signJwt) so the migration in
 * `apps/expo/src/keychain/signingKey.ts` is a single drop-in replacement.
 */
import type { HybridObject } from 'react-native-nitro-modules';

/**
 * Discriminated kinds for events the native side surfaces. We keep
 * Nitrogen-compatible string-literal unions only at the event level (not on
 * inputs) — Nitrogen accepts these for output types via the runtime `kind`
 * narrowing pattern documented in the Proximity spec.
 */
export type SpruceDidEventKind =
  | 'keyGenerated'
  | 'keyDeleted'
  | 'biometricPromptCancelled'
  | 'biometricPromptFailed'
  | 'keyRotationDetected'
  | 'error';

export interface SpruceDidEvent {
  readonly kind: SpruceDidEventKind;
  /** Populated for keyGenerated / keyDeleted / biometric* / keyRotationDetected. */
  readonly alias?: string;
  /** Populated for keyGenerated: 'p256' | 'ed25519' | 'secp256k1'. */
  readonly keyType?: string;
  /** Populated for keyGenerated: true if Secure Enclave / StrongBox-backed. */
  readonly hardwareBacked?: boolean;
  /** Populated for error / biometric*: human-readable message. */
  readonly message?: string;
  /** Populated for error: machine-readable error code. */
  readonly errorCode?: string;
}

export interface SpruceDid
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  /**
   * Generate a fresh hardware-backed keypair in Secure Enclave / StrongBox.
   * Returns the alias the caller can use to reference the key for sign / verify.
   *
   * `keyType` accepts 'p256' (Secure Enclave / StrongBox EC secp256r1),
   * 'ed25519' (Spruce KeyManager — may fall back to keychain-stored bytes),
   * or 'secp256k1' (Spruce KeyManager — same fallback). Unknown types throw.
   *
   * `requireBiometric=true` configures the key so every `signJws` /
   * `signRawP256` call prompts BiometricPrompt (Android) or
   * Face ID/Touch ID (iOS). Set to false for non-sensitive operations.
   */
  generateKey(
    alias: string,
    keyType: string,
    requireBiometric: boolean
  ): Promise<string>;

  /** Synchronous existence check — does not trigger biometric prompt. */
  hasKey(alias: string): boolean;

  /**
   * How signing with this alias is biometric-gated.
   *
   *   'native-acl' — the OS prompts INSIDE the keychain/keystore signing
   *                  operation itself (iOS legacy Secure Enclave key with
   *                  `.userPresence`; Android auth-bound key). The JS layer
   *                  must NOT stack its own prompt on top.
   *   'js-gated'   — no native gate on the key; the JS layer prompts
   *                  (`requireBiometric('sign')`).
   *
   * iOS detects via a one-time probe signature under an
   * `interactionNotAllowed` LAContext (result cached per alias per
   * process); Android reads `KeyInfo.isUserAuthenticationRequired`.
   * Unknown/edge cases resolve to 'js-gated' — fail-safe: the worst case
   * is the legacy double prompt, never a missing gate.
   */
  keyAuthMode(alias: string): Promise<string>;

  /** Tear down the key from the secure store. Returns true on success. */
  deleteKey(alias: string): Promise<boolean>;

  /**
   * JSON array of every iCloud-synchronizable P-256 item stored under
   * `alias`: `[{"label":"<hex>","publicKeyHex":"<hex 04||X||Y>"}]`.
   * More than one entry = two devices each minted a key before iCloud
   * Keychain replication converged (both items sync everywhere — the
   * application label, a hash of the public key, is part of a key item's
   * primary key, so they never overwrite each other). The JS layer renders
   * an explicit user-driven conflict resolver from this. Android has no
   * synchronizable keystore class and always returns `"[]"`.
   */
  listSyncableP256Keys(alias: string): Promise<string>;

  /**
   * Delete ONE synchronizable P-256 item by its application-label hex —
   * the user-approved loser of a sync conflict. Never called automatically;
   * never touches the non-synced class or other labels. Returns true iff an
   * item was actually deleted. Android always returns false.
   */
  deleteSyncableP256Key(alias: string, labelHex: string): Promise<boolean>;

  /** Public-key JWK (JSON string). Safe to publish; no private material exposed. */
  getPublicKeyJwk(alias: string): Promise<string>;

  // -- JWS signing (raw payload, not a full credential) ---------------------
  // DID derivation and JWS/VC *verification* are pure TS in packages/shared
  // (didKeyFromJwk / resolveDidKey / verifyJwtEs256) — never native.

  /**
   * Sign arbitrary bytes with the key referenced by `alias`. Returns compact
   * JWS serialization (RFC 7515) so callers can hand the result straight to
   * any JWT-aware verifier. Triggers biometric prompt if the key was generated
   * with `requireBiometric: true`.
   */
  signJws(alias: string, payload: ArrayBuffer): Promise<string>;

  /**
   * Sign a 32-byte SHA-256 digest directly with P-256 ECDSA and return the
   * raw 64-byte `r || s` signature. This is the OpenAC v3 device-binding
   * path: the circuit verifies the signature against `nonce_hash` as a
   * digest, not a JWS payload or JSON wrapper. Throws if `digest` is not
   * exactly 32 bytes.
   */
  signRawP256(alias: string, digest: ArrayBuffer): Promise<ArrayBuffer>;

  // -- Event stream ---------------------------------------------------------

  /** Returns an unsubscribe function. */
  addEventListener(handler: (event: SpruceDidEvent) => void): () => void;
}
