/**
 * Identity signing key — backed by the SpruceID Nitro module
 * (`@solidarity/nitro-spruce-did`) which generates and stores P-256 keys in
 * Secure Enclave (iOS) / StrongBox (Android). Replaces the prior
 * `@noble/curves` random keypair generation, which on React Native fell back
 * to a non-CSPRNG entropy source and never gave us hardware-backed forensics.
 *
 * Storage:
 *   iOS    : software P-256 key stored as a SYNCHRONISABLE Keychain item keyed
 *            by `solidarity.master.v2`, so iCloud Keychain replicates the DID
 *            across the user's devices and it survives a wipe / reinstall.
 *            (A Secure Enclave key — the prior design — cannot sync or be
 *            restored, which silently orphaned credentials after clear-data.)
 *            The private key still never reaches JS: signing is done natively
 *            via `SecKeyCreateSignature`. Biometric gating is enforced in JS
 *            (syncable items can't carry a biometric keychain ACL). Existing
 *            installs that already hold a non-syncable Secure Enclave key keep
 *            it (no forced rotation); the syncable key is minted only for fresh
 *            keys (new install / post-wipe). See `generateSyncableP256Key`.
 *   Android: AndroidKeyStore EC key (StrongBox-backed where available), same
 *            alias. The native biometric key flag is enabled only when the
 *            OS reports enrolled biometrics; Android rejects that key spec
 *            on fresh emulators/devices with no fingerprint enrolled.
 *
 * The private key never reaches JS — JWS signing and raw P-256 digest signing
 * both happen in native. Earlier callers that called `signJwt(header, payload)`
 * keep working because we re-export the same function signature; only the
 * implementation is replaced.
 *
 * Backwards-compatibility & migration story:
 *   1. v1 expo (this repo before the SpruceID nitro module) stored a raw
 *      32-byte P-256 private key in `expo-secure-store` under
 *      `gg.solidarity.signing.v2`. On first launch after this update we
 *      detect that alias, import the bytes into the SpruceID-managed alias
 *      (so existing JWS/DIDs continue to verify), then delete the legacy
 *      copy. The import path uses `generateKey` + a write-from-bytes private
 *      method exposed only for migration (TODO: wire when SpruceID SDK adds
 *      `importRawKey`). Until then the migration falls back to "delete
 *      legacy + generate new", which rotates the user's DID. Rotation is
 *      noisy but safer than holding raw bytes — and the next backup
 *      restore-from-cloud path also rotates DIDs.
 *   2. v1 SwiftUI used Keychain alias `solidarity.master.v2` directly (see
 *      `solidarity/Services/Identity/KeychainService.swift`). Because the
 *      new SpruceID iOS impl reuses the same keychain item shape
 *      (`kSecAttrApplicationTag = "gg.solidarity.sprucedid." + alias`),
 *      it WILL NOT find existing Swift-stored keys at the bare
 *      `solidarity.master.v2` tag. A future migration helper can copy keys
 *      across, but the existing parity tests don't run on real-device
 *      Keychain so this is captured as a TODO.
 *
 * Test mode:
 *   When `__SPRUCE_DID_TEST_DRIVER__` is set on `globalThis`, the in-memory
 *   driver from `apps/expo/__tests__/parity/spruceDid.parity.test.ts` takes
 *   over so unit tests don't load native modules.
 */
import * as SecureStore from 'expo-secure-store';

import {
  base64Decode,
  base64UrlDecode,
  base64UrlEncode,
  didKeyFromJwk,
  err,
  ok,
  publicKeyToJwk,
  publicKeyFromPrivate,
  sha256Bytes,
  type PublicKeyJWK,
  type Result,
  utf8ToBytes,
} from '@solidarity/shared';
import { publicKeyJwkSchema } from '@solidarity/shared';
import {
  getSpruceDid,
  type SpruceDid,
} from '@solidarity/nitro-spruce-did';

import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from '@/storage/deletionResult';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import { isBiometricAvailable, requireBiometric } from './biometric';
import { shouldRequireNativeBiometricBinding } from './signingKeyPolicy';

/**
 * Modern alias — matches the Swift app's `KeychainService.modernMasterAlias`
 * so installs that already use that namespace see one consistent identifier
 * across the JS / Swift boundary on iOS.
 */
const SIGNING_KEY_ALIAS = 'solidarity.master.v2';

/** Legacy expo-secure-store alias, used pre-SpruceID Nitro. Migrated on first launch. */
const LEGACY_EXPO_ALIAS = 'gg.solidarity.signing.v2';

/** Earliest legacy alias (Swift v0 / first AirMeishi install). Migrated only if v2 isn't present. */
const LEGACY_SWIFT_V0_ALIAS = 'kidneyweakx.airmeishi.signingKey';

const SECURE_OPTS_LEGACY: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your identity key',
};

/**
 * Identity handle returned by `ensureSigningKey()`. Holds the alias the
 * caller uses for sign/verify plus the cached public JWK (the only public
 * material that ever crosses the JSI boundary).
 *
 * NB: the legacy export was `P256KeyPair` with `privateKey` + `publicKey`
 * raw byte arrays. Anything that read `kp.privateKey` directly must be
 * updated to call into `signJwt` — there are no more raw bytes available.
 * See the migration note in `apps/expo/CLAUDE.md` rule 9 for the rationale.
 */
export interface SigningIdentity {
  readonly alias: string;
  readonly publicJwk: PublicKeyJWK;
}

let cachedIdentity: SigningIdentity | null = null;

// A key generation can outlive the screen that initiated it: native keychain
// creation and the public-JWK read are both asynchronous. The production wipe
// advances the local-data epoch, waits for these operations, and only then
// performs its authoritative deletion. That ordering prevents a pre-wipe
// `generateKey` completion from recreating the identity after deletion.
const activeSigningKeyOperations = new Set<Promise<unknown>>();

function trackSigningKeyOperation<T>(operation: Promise<T>): Promise<T> {
  activeSigningKeyOperations.add(operation);
  const remove = (): void => {
    activeSigningKeyOperations.delete(operation);
  };
  operation.then(remove, remove);
  return operation;
}

/** Wait for pre-wipe signing-key reads/provisioning to reach an epoch checkpoint. */
export async function quiesceSigningKeyOperations(): Promise<void> {
  while (activeSigningKeyOperations.size > 0) {
    await Promise.allSettled([...activeSigningKeyOperations]);
  }
}

function localDataWipeError(): Error {
  return new Error('Signing key provisioning was invalidated by a local data wipe');
}

/**
 * Best-effort cleanup for a native key that finished generating after its
 * operation became stale. The ordered wipe retries the same aliases through
 * `deleteSigningKey()` and reports any failure there, so this helper must not
 * turn a cancelled caller into a success path.
 */
async function deleteStaleSigningKey(): Promise<void> {
  const d = driver();
  await Promise.allSettled([
    d.deleteKey(SIGNING_KEY_ALIAS),
    ...[LEGACY_EXPO_ALIAS, LEGACY_SWIFT_V0_ALIAS].map((alias) =>
      SecureStore.deleteItemAsync(alias, SECURE_OPTS_LEGACY),
    ),
  ]);
  cachedIdentity = null;
  cachedAuthMode = null;
}

/**
 * How the active key is biometric-gated — resolved once per process from
 * the native driver. 'native-acl' = the OS prompts inside the keychain /
 * keystore sign itself (legacy SE key with .userPresence; auth-bound
 * Android key), so the JS layer must NOT stack its own prompt. Anything
 * unresolvable (older native binary without `keyAuthMode`, probe failure)
 * is 'js-gated' — fail-safe: worst case is the legacy double prompt,
 * never a missing gate.
 */
type KeyAuthMode = 'native-acl' | 'js-gated';
let cachedAuthMode: KeyAuthMode | null = null;

async function resolveKeyAuthMode(d: SpruceDid, alias: string): Promise<KeyAuthMode> {
  if (cachedAuthMode) return cachedAuthMode;
  let mode: KeyAuthMode = 'js-gated';
  try {
    const probe = (d as { keyAuthMode?: (alias: string) => Promise<string> }).keyAuthMode;
    if (typeof probe === 'function') {
      mode = (await probe.call(d, alias)) === 'native-acl' ? 'native-acl' : 'js-gated';
    }
  } catch {
    mode = 'js-gated';
  }
  cachedAuthMode = mode;
  return mode;
}

const P256_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/**
 * Returns the Nitro driver. Production callers always get the real
 * HybridObject; tests inject a stub via `globalThis.__SPRUCE_DID_TEST_DRIVER__`.
 */
function driver(): SpruceDid {
  const override = (globalThis as { __SPRUCE_DID_TEST_DRIVER__?: SpruceDid })
    .__SPRUCE_DID_TEST_DRIVER__;
  if (override) return override;
  return getSpruceDid();
}

/**
 * Read the legacy expo-secure-store bytes (if present) so we can decide
 * whether to migrate. Returns `null` on any failure — the caller treats
 * that as "no migration needed".
 */
async function readLegacyExpoBytes(): Promise<Uint8Array | null> {
  const candidates = [LEGACY_EXPO_ALIAS, LEGACY_SWIFT_V0_ALIAS];
  for (const alias of candidates) {
    const stored = await SecureStore.getItemAsync(alias, SECURE_OPTS_LEGACY).catch(
      () => null
    );
    if (stored) return base64Decode(stored);
  }
  return null;
}

/**
 * Best-effort cleanup of legacy bytes after a successful migration. We
 * intentionally swallow errors — a residual legacy entry just means the
 * next launch retries the migration logic, which is idempotent.
 */
async function clearLegacyExpoBytes(): Promise<void> {
  for (const alias of [LEGACY_EXPO_ALIAS, LEGACY_SWIFT_V0_ALIAS]) {
    await SecureStore.deleteItemAsync(alias, SECURE_OPTS_LEGACY).catch(() => {});
  }
}

/**
 * Public-key JWK helper. Pulls from the SpruceID driver and validates with
 * the same Zod schema everything else in the app uses.
 */
async function readPublicJwk(alias: string): Promise<PublicKeyJWK> {
  const raw = await driver().getPublicKeyJwk(alias);
  const parsed = JSON.parse(raw) as unknown;
  return publicKeyJwkSchema.parse(parsed);
}

/**
 * Get (or lazily create) the user's signing identity. The first call
 * generates a hardware-backed key in the enclave; subsequent calls return
 * the cached identity record.
 */
export function ensureSigningKey(): Promise<SigningIdentity> {
  return trackSigningKeyOperation(
    ensureSigningKeyAtEpoch(captureLocalDataEpoch()),
  );
}

async function ensureSigningKeyAtEpoch(
  writeEpoch: LocalDataEpoch,
): Promise<SigningIdentity> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (cachedIdentity) return cachedIdentity;

  const d = driver();

  // 1. Happy path — already provisioned in SpruceID.
  if (d.hasKey(SIGNING_KEY_ALIAS)) {
    const publicJwkValue = await readPublicJwk(SIGNING_KEY_ALIAS);
    if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
    cachedIdentity = { alias: SIGNING_KEY_ALIAS, publicJwk: publicJwkValue };
    return cachedIdentity;
  }

  // 2. Migration path — legacy expo bytes present? We can't import raw bytes
  //    into SecureEnclave (the whole point of SE is keys never leave it), so
  //    the best we can do is acknowledge the legacy key for diagnostic
  //    purposes, then generate a fresh hardware-backed key. The user's DID
  //    rotates; the cloud-backup restore path also rotates, so existing
  //    users are already familiar with the flow.
  //    TODO(spruce-key-import): if SpruceID SDK adds a raw-import API on
  //    iOS Secure Enclave bypass mode, swap this branch for an actual
  //    bytes-to-keychain import + emit a "migrationSucceeded" event.
  const legacyBytes = await readLegacyExpoBytes();
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (legacyBytes) {
    // Derive the legacy public key so the caller can persist it as a
    // "prior identity" record if they want to surface the rotation in UI.
    try {
      const legacyJwk = publicKeyToJwk(publicKeyFromPrivate(legacyBytes));
       
      console.warn(
        '[signingKey] legacy software-key detected; rotating to Secure Enclave. ' +
          `Old DID-key JWK x=${legacyJwk.x.slice(0, 6)}…`
      );
    } catch {
      // Legacy bytes corrupted — ignore, proceed with fresh generation.
    }
    await clearLegacyExpoBytes();
    if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  }

  // 3. Provision a fresh identity key.
  //
  //    keyType 'p256-syncable' makes the identity portable across a wipe /
  //    reinstall / new device:
  //      iOS     — a software P-256 key stored as a SYNCHRONISABLE keychain
  //                item, so iCloud Keychain replicates the DID across the
  //                user's devices (same Apple ID). A Secure Enclave key
  //                cannot do this — its private bytes never leave hardware, so
  //                it can be neither backed up nor synced, and restore always
  //                orphaned the user's credentials. Biometric gating moves to
  //                the JS layer (`requireBiometric('sign')` in signJwt /
  //                signRawEs256), since syncable items can't carry a biometric
  //                keychain ACL.
  //      Android — no iCloud Keychain; maps to the normal hardware-backed
  //                AndroidKeyStore key (does NOT sync — a separate concern).
  //
  //    AndroidKeyStore cannot create a per-use biometric key when no biometric
  //    is enrolled, so bind the native key to biometric auth only when the OS
  //    reports it can support it (ignored by the iOS syncable path).
  const requireNativeBiometric = shouldRequireNativeBiometricBinding(
    await isBiometricAvailable().catch(() => false)
  );
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  await d.generateKey(SIGNING_KEY_ALIAS, 'p256-syncable', requireNativeBiometric);
  if (!canCommitLocalData(writeEpoch)) {
    await deleteStaleSigningKey();
    throw localDataWipeError();
  }
  const publicJwkValue = await readPublicJwk(SIGNING_KEY_ALIAS);
  if (!canCommitLocalData(writeEpoch)) {
    await deleteStaleSigningKey();
    throw localDataWipeError();
  }
  cachedIdentity = { alias: SIGNING_KEY_ALIAS, publicJwk: publicJwkValue };
  return cachedIdentity;
}

/** Public-key JWK of the active signing key. */
export async function publicJwk(): Promise<PublicKeyJWK> {
  const id = await ensureSigningKey();
  return id.publicJwk;
}

/**
 * Sign a JWT with the active signing key, biometric-gated. The header /
 * payload are serialised here (so the caller doesn't have to worry about
 * canonical JSON), but the actual b64url + signature is produced inside
 * native — both branches return the same compact JWS shape the legacy
 * `@noble/curves` impl emitted.
 */
export async function signJwt(
  header: { alg: 'ES256'; typ?: string; kid?: string },
  payload: Readonly<Record<string, unknown>>
): Promise<string> {
  if (header.alg !== 'ES256') {
    throw new Error(`signJwt requires alg=ES256 (got ${header.alg})`);
  }
  const id = await ensureSigningKey();
  // Single-layer gate (phase 4): when the key carries a native ACL the OS
  // prompts inside the sign itself — the JS prompt would be a second
  // Face ID sheet for the same intent. JS gates only 'js-gated' keys.
  if ((await resolveKeyAuthMode(driver(), id.alias)) === 'js-gated') {
    const allowed = await requireBiometric('sign');
    if (!allowed) throw new Error('biometric authentication required');
  }
  // SpruceID's `signJws` always uses an ES256 / JWT header — so we hand it
  // just the payload bytes. For headers with custom `typ` or `kid`, the
  // caller can post-process the returned JWS (replace the first segment),
  // because all the cryptographic work is bound to the payload + signature
  // segments.
  const payloadBytes = utf8ToBytes(JSON.stringify(payload));
  // ArrayBuffer view that the Nitro bridge can serialise zero-copy.
  const buf = new ArrayBuffer(payloadBytes.length);
  new Uint8Array(buf).set(payloadBytes);
  const jws = await driver().signJws(id.alias, buf);

  // Allow callers to override the default header — splice in their JSON.
  if (header.typ !== undefined || header.kid !== undefined) {
    const parts = jws.split('.');
    if (parts.length !== 3) return jws;
    const customHeaderJson = JSON.stringify(header);
    const customHeaderB64 = base64UrlEncode(utf8ToBytes(customHeaderJson));
    return `${customHeaderB64}.${parts[1]}.${parts[2]}`;
  }
  return jws;
}

/**
 * Resolve a `did:key:z…` for the active signing key. The native side already
 * exposes a validated P-256 public JWK; derive the DID locally with the shared
 * parity-tested encoder so share / VC issuance do not depend on SpruceID's
 * runtime resolver.
 */
export async function didKeyForCurrentIdentity(): Promise<string> {
  const id = await ensureSigningKey();
  return didKeyFromJwk(id.publicJwk);
}

/**
 * Raw P-256 ECDSA signature over arbitrary bytes, plus the matching raw
 * verification key. Native signs `SHA-256(payload)` directly and returns
 * raw 64-byte `r || s`, matching Swift CryptoKit-style raw signatures
 * without routing through a JWS wrapper.
 *
 * Biometric gate: same as `signJwt` — `requireBiometric('sign')` runs first.
 */
export async function signRawEs256(payload: Uint8Array): Promise<{
  readonly signature: Uint8Array;
  readonly publicKeyRaw: Uint8Array;
}> {
  return signDigestWithCurrentKey(sha256Bytes(payload), 'signRawEs256');
}

export async function signOpenAcDeviceBindingDigest(
  nonceHash: Uint8Array
): Promise<{
  readonly signature: Uint8Array;
  readonly publicKeyRaw: Uint8Array;
}> {
  if (nonceHash.length !== 32) {
    throw new Error(
      `signOpenAcDeviceBindingDigest: expected 32-byte nonce_hash (got ${nonceHash.length})`
    );
  }
  return signDigestWithCurrentKey(nonceHash, 'signOpenAcDeviceBindingDigest');
}

export async function publicRawP256ForCurrentIdentity(): Promise<Uint8Array> {
  const id = await ensureSigningKey();
  return rawP256PublicKeyFromJwk(id.publicJwk, 'publicRawP256ForCurrentIdentity');
}

async function signDigestWithCurrentKey(
  digest: Uint8Array,
  context: string
): Promise<{
  readonly signature: Uint8Array;
  readonly publicKeyRaw: Uint8Array;
}> {
  // Biometric-gate every raw signature (CLAUDE.md Sec rule). The shared
  // grace bucket (see biometric.ts) reuses a recent authorization instead
  // of re-prompting per call; keys with a native ACL are gated by the OS
  // prompt inside the sign itself (single-layer gate, phase 4).
  const id = await ensureSigningKey();
  if ((await resolveKeyAuthMode(driver(), id.alias)) === 'js-gated') {
    const allowed = await requireBiometric('sign');
    if (!allowed) throw new Error('biometric authentication required');
  }
  const buf = new ArrayBuffer(digest.length);
  new Uint8Array(buf).set(digest);
  const signatureBuffer = await driver().signRawP256(id.alias, buf);
  const signature = new Uint8Array(signatureBuffer);
  if (signature.length !== 64) {
    throw new Error(
      `${context}: expected 64-byte raw P-256 signature (got ${signature.length})`
    );
  }
  const publicKeyRaw = rawP256PublicKeyFromJwk(id.publicJwk, context);
  return { signature: normalizeP256LowS(signature), publicKeyRaw };
}

function normalizeP256LowS(signature: Uint8Array): Uint8Array {
  const s = rawBigEndianToBigInt(signature.slice(32));
  if (s <= P256_N / 2n) return signature;

  const out = new Uint8Array(signature);
  out.set(bigIntToRawBigEndian(P256_N - s), 32);
  return out;
}

function rawBigEndianToBigInt(bytes: Uint8Array): bigint {
  let out = 0n;
  for (const byte of bytes) out = (out << 8n) | BigInt(byte);
  return out;
}

function bigIntToRawBigEndian(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i -= 1) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function rawP256PublicKeyFromJwk(
  jwk: PublicKeyJWK,
  context: string
): Uint8Array {
  const x = base64UrlDecode(jwk.x);
  const y = base64UrlDecode(jwk.y);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error(`${context}: invalid P-256 public-key JWK shape`);
  }
  const publicKeyRaw = new Uint8Array(64);
  publicKeyRaw.set(x, 0);
  publicKeyRaw.set(y, 32);
  return publicKeyRaw;
}

/**
 * Digest that `signRawEs256(payload)` signs. Retained for existing verifier
 * code that asks this module how to reconstruct the signed bytes.
 */
export function wrapRawSigningInputForSpruce(payload: Uint8Array): Uint8Array {
  return sha256Bytes(payload);
}

/**
 * Permanently delete the active signing key and every legacy copy.
 *
 * Teardown is intentionally all-attempting: a native driver failure must not
 * prevent cleanup of legacy SecureStore aliases. Any failed deletion is then
 * surfaced so the caller cannot report a complete wipe.
 */
export async function deleteSigningKey(): Promise<LocalDeletionResult> {
  await quiesceSigningKeyOperations();
  // The native deleteKey contract already deletes every EC item for this
  // alias (`kSecAttrSynchronizableAny` on iOS), including T7 duplicates.
  // Deleting enumerated syncable rows first would make this authoritative
  // call fulfill with false after a successful pre-delete and incorrectly
  // report every normal iOS wipe as incomplete.
  const operations: readonly (() => Promise<unknown>)[] = [
    () => driver().deleteKey(SIGNING_KEY_ALIAS),
    ...[LEGACY_EXPO_ALIAS, LEGACY_SWIFT_V0_ALIAS].map(
      (alias) => () => SecureStore.deleteItemAsync(alias, SECURE_OPTS_LEGACY),
    ),
  ];
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation)),
  );
  cachedIdentity = null;
  cachedAuthMode = null;
  const [activeResult, ...legacyResults] = results;
  const activeDeleteFailed =
    activeResult === undefined ||
    activeResult.status === 'rejected' ||
    activeResult.value !== true;
  const legacyDeleteFailed = legacyResults.some(
    (result) => result.status === 'rejected',
  );
  if (activeDeleteFailed || legacyDeleteFailed) {
    return deletionFailed();
  }
  return deletionSucceeded();
}

/** Test-only — wipes the active alias plus all legacy aliases. */
export async function resetSigningKeyForTesting(): Promise<void> {
  await deleteSigningKey();
}

// ── T7: iCloud-synced signing-key conflict surface ────────────────────────

/**
 * Non-minting existence probe. `ensureSigningKey` GENERATES on a miss —
 * during the iCloud Keychain replication window that mints a competitor to
 * the user's real key (T7), so the onboarding wait gate needs a probe that
 * can never mint.
 */
export async function hasExistingSigningKey(): Promise<boolean> {
  if (cachedIdentity) return true;
  try {
    return driver().hasKey(SIGNING_KEY_ALIAS);
  } catch {
    return false;
  }
}

export interface SigningKeyCandidate {
  readonly labelHex: string;
  readonly publicKeyHex: string;
  /** True for the key the deterministic native resolver currently signs with. */
  readonly active: boolean;
}

function parseCandidateRows(raw: string): readonly { labelHex: string; publicKeyHex: string }[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rows: { labelHex: string; publicKeyHex: string }[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const label = (entry as Record<string, unknown>)['label'];
      const publicKeyHex = (entry as Record<string, unknown>)['publicKeyHex'];
      if (typeof label === 'string' && typeof publicKeyHex === 'string') {
        rows.push({ labelHex: label, publicKeyHex });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

function hexFromBytes(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `04 || X || Y` hex of the resolver's current winner; null when no key. */
async function activePublicKeyHex(): Promise<string | null> {
  try {
    if (!driver().hasKey(SIGNING_KEY_ALIAS)) return null;
    const jwk = await readPublicJwk(SIGNING_KEY_ALIAS);
    return `04${hexFromBytes(base64UrlDecode(jwk.x))}${hexFromBytes(base64UrlDecode(jwk.y))}`;
  } catch {
    return null;
  }
}

/**
 * Every iCloud-synced signing-key item under the identity alias, with the
 * resolver's current winner marked. Length > 1 = a T7 double-mint conflict
 * (the settings resolver renders only then). Fail-closed `[]` on any driver
 * or parse failure — a broken probe must never look like a conflict.
 */
export async function listSyncableSigningKeys(): Promise<readonly SigningKeyCandidate[]> {
  try {
    const rows = parseCandidateRows(await driver().listSyncableP256Keys(SIGNING_KEY_ALIAS));
    if (rows.length === 0) return [];
    const active = await activePublicKeyHex();
    return rows.map((row) => ({ ...row, active: active !== null && row.publicKeyHex === active }));
  } catch {
    return [];
  }
}

/**
 * Keep ONE candidate and delete every other synced item under the alias —
 * the user-approved resolution of a T7 conflict. Face-ID-gated with the
 * always-prompt 'delete' reason (grace window deliberately bypassed: this
 * destroys key material). Never called automatically. Clears the process
 * identity cache so the next signer resolves onto the kept key.
 */
export async function resolveSigningKeyConflict(
  keepLabelHex: string
): Promise<Result<void, string>> {
  const allowed = await requireBiometric('delete');
  if (!allowed) return err('biometricDenied');
  const rows = parseCandidateRows(await driver().listSyncableP256Keys(SIGNING_KEY_ALIAS));
  if (!rows.some((row) => row.labelHex === keepLabelHex)) {
    return err('keepTargetMissing');
  }
  let failures = 0;
  for (const row of rows) {
    if (row.labelHex === keepLabelHex) continue;
    const deleted = await driver()
      .deleteSyncableP256Key(SIGNING_KEY_ALIAS, row.labelHex)
      .catch(() => false);
    if (!deleted) failures += 1;
  }
  cachedIdentity = null;
  return failures > 0 ? err('deleteFailed') : ok(undefined);
}
