/**
 * Nitro spec — SpruceID DID
 *
 * Wraps SpruceID's mobile SDKs (https://github.com/spruceid/sprucekit-mobile)
 * to back DID key generation + DID document management with hardware-backed
 * keystores:
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
   * `signCredentialJwt` call prompts BiometricPrompt (Android) or
   * Face ID/Touch ID (iOS). Set to false for non-sensitive operations.
   */
  generateKey(
    alias: string,
    keyType: string,
    requireBiometric: boolean
  ): Promise<string>;

  /** Synchronous existence check — does not trigger biometric prompt. */
  hasKey(alias: string): boolean;

  /** Tear down the key from the secure store. Returns true on success. */
  deleteKey(alias: string): Promise<boolean>;

  /** Public-key JWK (JSON string). Safe to publish; no private material exposed. */
  getPublicKeyJwk(alias: string): Promise<string>;

  // -- DID method helpers ---------------------------------------------------

  /**
   * Derive `did:key:z…` from a stored alias using the Spruce DID resolver.
   * The output is byte-identical to the legacy Swift KeychainService +
   * DIDKeyResolver pipeline so installs upgrading from v1 keep their DID.
   */
  didKeyFromAlias(alias: string): Promise<string>;

  /** Resolve a DID to its DID document (JSON string). did:key / did:web / did:jwk. */
  didDocumentJson(did: string): Promise<string>;

  // -- JWS sign / verify (raw payload, not a full credential) --------------

  /**
   * Sign arbitrary bytes with the key referenced by `alias`. Returns compact
   * JWS serialization (RFC 7515) so callers can hand the result straight to
   * any JWT-aware verifier. Triggers biometric prompt if the key was generated
   * with `requireBiometric: true`.
   */
  signJws(alias: string, payload: ArrayBuffer): Promise<string>;

  /**
   * Verify a compact JWS using the DID's published verification method.
   * Resolves to true iff the signature passes. Throws on malformed JWS or
   * DID resolution failures.
   */
  verifyJws(jws: string, did: string): Promise<boolean>;

  // -- VC issuance + verification (full sd-jwt + JSON-LD via Spruce) -------

  /**
   * Issue a signed Verifiable Credential. `claimsJson` is a JSON-stringified
   * object matching the W3C VC data model (or VC-JWT shape). Returns the
   * signed VC-JWT.
   */
  signCredentialJwt(alias: string, claimsJson: string): Promise<string>;

  /**
   * Verify a VC-JWT issued by any compatible issuer. Returns the verified
   * claims as a JSON string, or throws on signature / status / schema failure.
   */
  verifyCredentialJwt(jwt: string): Promise<string>;

  // -- Event stream ---------------------------------------------------------

  /** Returns an unsubscribe function. */
  addEventListener(handler: (event: SpruceDidEvent) => void): () => void;
}
