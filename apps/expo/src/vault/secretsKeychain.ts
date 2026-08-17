/**
 * Vault root secret — the 32-byte AES key that seals every vault item.
 *
 * Mirrors solidarity/Services/Vault/VaultSecretsKeychain.swift +
 * FileEncryptionService.swift's `getOrCreateVaultKey()`. The key never
 * leaves the device storage. As of v1.3.x the at-rest representation is
 * upgraded from "raw 32 bytes in expo-secure-store" to "ECIES / AES-GCM
 * blob wrapped by a hardware-backed key" via
 * `@solidarity/nitro-secrets-vault`:
 *
 *   iOS    : Secure Enclave P-256 KeyAgreement key + HPKE-style ECIES.
 *            The wrapped blob lives in expo-secure-store (still
 *            biometric-gated as defence-in-depth); the wrapping key
 *            itself never leaves the SE.
 *   Android: AndroidKeyStore AES-256-GCM with `setIsStrongBoxBacked(true)`
 *            (falls back to TEE on devices without StrongBox).
 *
 * When the device has no hardware-backed key store at all (rare; pre-M
 * Android or a borked simulator) we keep the legacy path that stores
 * the 32 plaintext bytes directly in expo-secure-store and emit a
 * `console.warn` so the downgrade is at least observable in logs /
 * Sentry.
 *
 * Public API unchanged:
 *   - `getOrCreateRootSecret({ biometric: true  })` — sensitive ops
 *     (shard distribution, recovery, export). Resolves to
 *     `Result.err('biometricDenied')` when the user denies the prompt.
 *   - `getOrCreateRootSecret({ biometric: false })` — background sync /
 *     unlocked-foreground reads. Returns the bytes without a prompt as
 *     long as the device is unlocked and the prior biometric session is
 *     still cached in-process.
 *
 * `rotateRootSecret` re-seals every existing vault item under a new key
 * in a single best-effort pass and surfaces progress through the
 * optional `onProgress` callback. Failure to re-seal one item does NOT
 * abort the whole rotation — the failing item is returned in the result
 * so the caller can offer the user a retry.
 */
import * as SecureStore from 'expo-secure-store';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  generateAesKey,
} from '@solidarity/shared';

import {
  getSecretsVault,
  type SecretsVault,
  type WrappedSecret,
} from '@solidarity/nitro-secrets-vault';

import { requireBiometric } from '@/keychain/biometric';
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
import * as FileSystem from 'expo-file-system/legacy';

import type { VaultItem } from './store';

/** Storage alias — distinct from the masterKey aliases used by MMKV/backup. */
const ROOT_SECRET_ALIAS = 'gg.solidarity.vault.rootSecret.v1';

/**
 * Alias for the hardware-backed wrapping key inside Secure Enclave /
 * StrongBox. The stored blob in expo-secure-store under
 * `ROOT_SECRET_ALIAS` is the ciphertext + wrapping metadata serialised
 * via the `EncodedRootSecret` envelope below.
 */
const WRAPPING_KEY_ALIAS = 'gg.solidarity.vault.rootSecret.wrapping.v1';

/**
 * v2 wrapping key — ACL-FREE (no `.userPresence` / auth-bound flag).
 * The v1 key was provisioned with a native biometric ACL, which stacked a
 * SECOND OS prompt inside `unwrap` on top of the JS `'exchange'` gate
 * (and broke silent-mode background unwraps). Phase 4 (2026-06-13): the
 * JS gate — now riding the shared grace bucket — is the canonical prompt;
 * the SE/StrongBox key keeps non-extractability only. v1 envelopes are
 * migrated on the next biometric-mode read.
 */
const WRAPPING_KEY_ALIAS_V2 = 'gg.solidarity.vault.rootSecret.wrapping.v2';

/**
 * Whether the persisted blob is a hardware-wrapped envelope (`v1.hw`) or
 * a legacy plain 32-byte AES root (`v0.raw`). Stored as a JSON envelope
 * inside expo-secure-store so future migrations stay cheap.
 */
type EncodedRootSecret =
  | {
      readonly kind: 'v1.hw';
      readonly algorithm: string;
      readonly keyAlias: string;
      readonly wrappedB64: string;
      readonly hardwareBacked: boolean;
    }
  | { readonly kind: 'v0.raw'; readonly rootB64: string };

const SECURE_OPTS_BIOMETRIC: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: true,
  authenticationPrompt: 'Unlock your vault',
};

const SECURE_OPTS_NO_BIOMETRIC: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};

export type AccessMode = 'biometric' | 'silent';

/** Discriminated-union result so callers can branch on `kind`. */
export type RootSecretResult =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'err'; readonly reason: 'biometricDenied' | 'storageFailed' };

let cachedSecret: Uint8Array | null = null;

// SecureStore and native wrapping-key operations are asynchronous. Keep every
// provisioning/rotation operation observable so the destructive wipe can
// invalidate it, wait for its final epoch check, and only then delete the
// root secret and wrapping keys.
const activeRootSecretOperations = new Set<Promise<unknown>>();

function trackRootSecretOperation<T>(operation: Promise<T>): Promise<T> {
  activeRootSecretOperations.add(operation);
  const remove = (): void => {
    activeRootSecretOperations.delete(operation);
  };
  operation.then(remove, remove);
  return operation;
}

/** Wait for vault-root reads/provisioning/rotation that began before a wipe. */
export async function quiesceRootSecretOperations(): Promise<void> {
  while (activeRootSecretOperations.size > 0) {
    await Promise.allSettled([...activeRootSecretOperations]);
  }
}

function localDataWipeError(): Error {
  return new Error('Vault root-secret operation was invalidated by a local data wipe');
}

function opts(mode: AccessMode): SecureStore.SecureStoreOptions {
  return mode === 'biometric' ? SECURE_OPTS_BIOMETRIC : SECURE_OPTS_NO_BIOMETRIC;
}

/**
 * Resolve the Nitro driver. Production callers always get the real
 * HybridObject; tests inject a stub via
 * `globalThis.__SECRETS_VAULT_TEST_DRIVER__`.
 */
function vaultDriver(): SecretsVault {
  const override = (globalThis as { __SECRETS_VAULT_TEST_DRIVER__?: SecretsVault })
    .__SECRETS_VAULT_TEST_DRIVER__;
  if (override) return override;
  return getSecretsVault();
}

/**
 * A stale root-secret writer may have created a SecureStore item or wrapping
 * key just after its epoch was invalidated. This is deliberately best-effort:
 * production follows it with `deleteRootSecret()`, which reports a failed
 * authoritative deletion instead of claiming the wipe succeeded.
 */
async function deleteStaleRootSecret(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_BIOMETRIC),
    SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_NO_BIOMETRIC),
    vaultDriver().deleteKey(WRAPPING_KEY_ALIAS),
    vaultDriver().deleteKey(WRAPPING_KEY_ALIAS_V2),
  ]);
  cachedSecret = null;
  hardwareAvailability = null;
}

/**
 * Best-effort probe — does this device expose a hardware-backed
 * wrapping key? The result is cached per-launch so we don't pay the
 * round-trip on every `getOrCreateRootSecret`.
 */
let hardwareAvailability: boolean | null = null;
function hardwareAvailable(): boolean {
  if (hardwareAvailability !== null) return hardwareAvailability;
  try {
    hardwareAvailability = vaultDriver().isHardwareAvailable();
  } catch {
    hardwareAvailability = false;
  }
  return hardwareAvailability;
}

function encodeWrapped(w: WrappedSecret): EncodedRootSecret {
  return {
    kind: 'v1.hw',
    algorithm: w.algorithm,
    keyAlias: w.keyAlias,
    wrappedB64: base64Encode(new Uint8Array(w.wrapped)),
    hardwareBacked: w.hardwareBacked,
  };
}

function decodeWrapped(env: Extract<EncodedRootSecret, { kind: 'v1.hw' }>): WrappedSecret {
  const bytes = base64Decode(env.wrappedB64);
  // ArrayBuffer copy keeps the Nitro bridge happy (it doesn't accept
  // Uint8Array directly through the JSI boundary).
  const buf = new ArrayBuffer(bytes.length);
  new Uint8Array(buf).set(bytes);
  return {
    algorithm: env.algorithm,
    keyAlias: env.keyAlias,
    wrapped: buf,
    hardwareBacked: env.hardwareBacked,
  };
}

function uint8FromArrayBuffer(buf: ArrayBuffer): Uint8Array {
  return new Uint8Array(buf.slice(0));
}

async function readEnvelope(
  mode: AccessMode
): Promise<EncodedRootSecret | null> {
  const raw = await SecureStore.getItemAsync(ROOT_SECRET_ALIAS, opts(mode));
  if (!raw) return null;
  // The legacy v0 path stored raw base64 (no JSON envelope). We detect
  // that shape so an in-place upgrade keeps working for existing users.
  try {
    const parsed = JSON.parse(raw) as Partial<EncodedRootSecret> & { kind?: string };
    if (parsed.kind === 'v1.hw' || parsed.kind === 'v0.raw') {
      return parsed as EncodedRootSecret;
    }
  } catch {
    // Not JSON — fall through to legacy raw-base64 interpretation.
  }
  return { kind: 'v0.raw', rootB64: raw };
}

async function writeEnvelope(
  env: EncodedRootSecret,
  _mode: AccessMode,
  writeEpoch: LocalDataEpoch,
): Promise<void> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  const serialised = env.kind === 'v0.raw' ? env.rootB64 : JSON.stringify(env);
  // Always stored WITHOUT an item-level auth ACL (phase 4): the envelope is
  // ciphertext under the hardware wrapping key, and the JS 'exchange' gate
  // is the user-facing prompt. The old `requireAuthentication: true` write
  // made even silent-mode reads trigger a native keychain prompt.
  await SecureStore.setItemAsync(ROOT_SECRET_ALIAS, serialised, SECURE_OPTS_NO_BIOMETRIC);
  if (!canCommitLocalData(writeEpoch)) {
    await deleteStaleRootSecret();
    throw localDataWipeError();
  }
}

/**
 * Wrap the 32-byte root via the Nitro driver. Returns the encoded
 * envelope ready for persistence. Falls back to the v0 raw layout if
 * the hardware driver throws — but emits a console.warn so the
 * downgrade is observable.
 */
async function wrapRoot(
  bytes: Uint8Array,
  writeEpoch: LocalDataEpoch,
): Promise<EncodedRootSecret> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (!hardwareAvailable()) {
    console.warn(
      '[secretsKeychain] hardware-backed wrapping unavailable; storing plain root in secure-store'
    );
    return { kind: 'v0.raw', rootB64: base64Encode(bytes) };
  }
  try {
    const driver = vaultDriver();
    await driver.ensureWrappingKey(WRAPPING_KEY_ALIAS_V2, false);
    if (!canCommitLocalData(writeEpoch)) {
      await deleteStaleRootSecret();
      throw localDataWipeError();
    }
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    const wrapped = await driver.wrap(WRAPPING_KEY_ALIAS_V2, buf);
    if (!canCommitLocalData(writeEpoch)) {
      await deleteStaleRootSecret();
      throw localDataWipeError();
    }
    return encodeWrapped(wrapped);
  } catch (e) {
    if (!canCommitLocalData(writeEpoch)) {
      await deleteStaleRootSecret();
      throw localDataWipeError();
    }
    console.warn(
      '[secretsKeychain] hardware wrap failed; falling back to plain root',
      e
    );
    return { kind: 'v0.raw', rootB64: base64Encode(bytes) };
  }
}

/**
 * Unwrap a previously-stored envelope back to the 32-byte root. Returns
 * null if the envelope is malformed (rare; we treat as "fall back to
 * generating a fresh key" rather than throwing because a single decode
 * failure shouldn't lock the user out of their vault).
 */
async function unwrapRoot(env: EncodedRootSecret): Promise<Uint8Array | null> {
  if (env.kind === 'v0.raw') {
    try {
      return base64Decode(env.rootB64);
    } catch {
      return null;
    }
  }
  try {
    const ab = await vaultDriver().unwrap(decodeWrapped(env));
    const out = uint8FromArrayBuffer(ab);
    return out.length === 32 ? out : null;
  } catch (e) {
    console.warn('[secretsKeychain] hardware unwrap failed', e);
    return null;
  }
}

/**
 * Read the root secret with the requested access mode. Generates a fresh
 * 32-byte key on first call. The biometric mode goes through
 * `requireBiometric('exchange')` first so the failure surface is
 * identical to every other Face ID-gated path (matches CLAUDE.md Sec
 * rules).
 */
export function getOrCreateRootSecret(
  mode: AccessMode = 'biometric'
): Promise<RootSecretResult> {
  return trackRootSecretOperation(
    getOrCreateRootSecretAtEpoch(mode, captureLocalDataEpoch()),
  );
}

async function getOrCreateRootSecretAtEpoch(
  mode: AccessMode,
  writeEpoch: LocalDataEpoch,
): Promise<RootSecretResult> {
  if (!canCommitLocalData(writeEpoch)) {
    return { kind: 'err', reason: 'storageFailed' };
  }
  if (cachedSecret && mode === 'silent') {
    return { kind: 'ok', bytes: cachedSecret };
  }

  if (mode === 'biometric') {
    // TODO(biometric-gate): swap for
    //   const gate = await requireSensitiveAction(
    //     action /* 'exportGraph' | 'rotateMasterKey' | 'revealRecoveryBundle' */,
    //     promptFor(action)
    //   );
    //   if (!gate.success) return { kind: 'err', reason: 'biometricDenied' };
    // so the unlock obeys the per-action policy in
    // `useSensitiveActionPolicy`. Pass `action` as an extra arg, defaulting
    // to `'exportGraph'`. Today this always demands biometric regardless
    // of the user's policy preferences.
    const allowed = await requireBiometric('exchange');
    if (!allowed) return { kind: 'err', reason: 'biometricDenied' };
    if (!canCommitLocalData(writeEpoch)) {
      return { kind: 'err', reason: 'storageFailed' };
    }
  }

  try {
    const stored = await readEnvelope(mode);
    const restored = stored ? await unwrapRoot(stored) : null;
    if (!canCommitLocalData(writeEpoch)) {
      return { kind: 'err', reason: 'storageFailed' };
    }
    if (restored?.length === 32 && stored) {
      await maybeUpgradeToHardware(stored, restored, mode, writeEpoch);
      await maybeMigrateWrappingKeyToV2(stored, restored, mode, writeEpoch);
      if (!canCommitLocalData(writeEpoch)) {
        return { kind: 'err', reason: 'storageFailed' };
      }
      cachedSecret = restored;
      return { kind: 'ok', bytes: restored };
    }
    const fresh = generateAesKey();
    const envelope = await wrapRoot(fresh, writeEpoch);
    await writeEnvelope(envelope, mode, writeEpoch);
    if (!canCommitLocalData(writeEpoch)) {
      return { kind: 'err', reason: 'storageFailed' };
    }
    cachedSecret = fresh;
    return { kind: 'ok', bytes: fresh };
  } catch {
    return { kind: 'err', reason: 'storageFailed' };
  }
}

/**
 * One-time migration off the v1 wrapping key (native `.userPresence` ACL →
 * double prompt). Runs only on biometric-mode reads (the user is present,
 * and the v1 unwrap that just succeeded consumed its native prompt). Direct
 * driver calls — NOT `wrapRoot` — so a failure can never downgrade the
 * envelope to a v0 plaintext root; on any error the v1 envelope stays.
 */
async function maybeMigrateWrappingKeyToV2(
  stored: EncodedRootSecret,
  bytes: Uint8Array,
  mode: AccessMode,
  writeEpoch: LocalDataEpoch,
): Promise<void> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (
    mode !== 'biometric' ||
    stored.kind !== 'v1.hw' ||
    stored.keyAlias !== WRAPPING_KEY_ALIAS
  ) {
    return;
  }
  try {
    const driver = vaultDriver();
    await driver.ensureWrappingKey(WRAPPING_KEY_ALIAS_V2, false);
    if (!canCommitLocalData(writeEpoch)) {
      await deleteStaleRootSecret();
      throw localDataWipeError();
    }
    const buf = new ArrayBuffer(bytes.length);
    new Uint8Array(buf).set(bytes);
    const wrapped = await driver.wrap(WRAPPING_KEY_ALIAS_V2, buf);
    if (!canCommitLocalData(writeEpoch)) {
      await deleteStaleRootSecret();
      throw localDataWipeError();
    }
    // Delete-then-write so the new item is created without the old
    // item-level auth ACL (SecItemUpdate cannot swap kSecAttrAccessControl).
    await SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_NO_BIOMETRIC).catch(
      () => undefined
    );
    await writeEnvelope(encodeWrapped(wrapped), mode, writeEpoch);
    await driver.deleteKey(WRAPPING_KEY_ALIAS).catch(() => undefined);
  } catch (e) {
    if (!canCommitLocalData(writeEpoch)) {
      await deleteStaleRootSecret();
      throw localDataWipeError();
    }
    console.warn(
      '[secretsKeychain] wrapping-key v2 migration failed; keeping v1 envelope',
      e
    );
  }
}

/**
 * Opportunistic upgrade: if we recovered a v0.raw envelope and hardware
 * wrapping is now available, re-seal it under the hardware key so
 * future reads ride the secure-element path. Best-effort; persistence
 * errors are swallowed because the next call will retry.
 */
async function maybeUpgradeToHardware(
  stored: EncodedRootSecret,
  bytes: Uint8Array,
  mode: AccessMode,
  writeEpoch: LocalDataEpoch,
): Promise<void> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (stored.kind !== 'v0.raw' || !hardwareAvailable()) return;
  const upgraded = await wrapRoot(bytes, writeEpoch);
  if (upgraded.kind !== 'v1.hw') return;
  try {
    await writeEnvelope(upgraded, mode, writeEpoch);
  } catch {
    if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  }
}

/** Clear the in-memory copy. Triggers a fresh prompt on next access. */
export function evictCachedRootSecret(): void {
  cachedSecret = null;
}

export interface RotationProgress {
  readonly processed: number;
  readonly total: number;
  readonly currentItemId?: string;
}

export interface RotationResult {
  readonly kind: 'ok' | 'partial' | 'err';
  readonly resealedItemIds: readonly string[];
  readonly failedItemIds: readonly string[];
  readonly reason?: 'biometricDenied' | 'storageFailed';
}

/**
 * Rotate the root secret: generate a fresh key, re-seal every existing
 * vault file with the new key, then commit the new key.
 *
 * Best-effort: failures to re-seal individual items are recorded in the
 * result rather than aborting. Callers may inspect `failedItemIds` and
 * surface a retry. The new key is only persisted if at least one item
 * was successfully re-sealed (or if there are no items).
 */
export function rotateRootSecret(
  items: readonly VaultItem[],
  onProgress?: (p: RotationProgress) => void
): Promise<RotationResult> {
  return trackRootSecretOperation(
    rotateRootSecretAtEpoch(items, onProgress, captureLocalDataEpoch()),
  );
}

async function rotateRootSecretAtEpoch(
  items: readonly VaultItem[],
  onProgress: ((p: RotationProgress) => void) | undefined,
  writeEpoch: LocalDataEpoch,
): Promise<RotationResult> {
  if (!canCommitLocalData(writeEpoch)) {
    return {
      kind: 'err',
      resealedItemIds: [],
      failedItemIds: items.map((item) => item.id),
      reason: 'storageFailed',
    };
  }
  const current = await getOrCreateRootSecret('biometric');
  if (current.kind === 'err') {
    return {
      kind: 'err',
      resealedItemIds: [],
      failedItemIds: items.map((i) => i.id),
      reason: current.reason,
    };
  }

  const next = generateAesKey();
  const resealed: string[] = [];
  const failed: string[] = [];

  for (const [index, item] of items.entries()) {
    if (!canCommitLocalData(writeEpoch)) {
      return {
        kind: 'err',
        resealedItemIds: resealed,
        failedItemIds: [...failed, ...items.slice(index).map((rest) => rest.id)],
        reason: 'storageFailed',
      };
    }
    onProgress?.({ processed: index, total: items.length, currentItemId: item.id });
    try {
      const sealedB64 = await FileSystem.readAsStringAsync(item.encryptedPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (!canCommitLocalData(writeEpoch)) {
        return {
          kind: 'err',
          resealedItemIds: resealed,
          failedItemIds: [...failed, ...items.slice(index).map((rest) => rest.id)],
          reason: 'storageFailed',
        };
      }
      const plaintext = aesGcmOpen(current.bytes, base64Decode(sealedB64));
      const resealedBytes = aesGcmSeal(next, plaintext);
      await FileSystem.writeAsStringAsync(
        item.encryptedPath,
        base64Encode(resealedBytes),
        { encoding: FileSystem.EncodingType.Base64 }
      );
      if (!canCommitLocalData(writeEpoch)) {
        return {
          kind: 'err',
          resealedItemIds: resealed,
          failedItemIds: [...failed, ...items.slice(index).map((rest) => rest.id)],
          reason: 'storageFailed',
        };
      }
      resealed.push(item.id);
    } catch {
      failed.push(item.id);
    }
  }
  onProgress?.({ processed: items.length, total: items.length });

  if (!canCommitLocalData(writeEpoch)) {
    return {
      kind: 'err',
      resealedItemIds: resealed,
      failedItemIds: failed,
      reason: 'storageFailed',
    };
  }

  if (items.length > 0 && resealed.length === 0) {
    return { kind: 'err', resealedItemIds: [], failedItemIds: failed, reason: 'storageFailed' };
  }

  try {
    const envelope = await wrapRoot(next, writeEpoch);
    await writeEnvelope(envelope, 'biometric', writeEpoch);
    if (!canCommitLocalData(writeEpoch)) {
      return {
        kind: 'err',
        resealedItemIds: resealed,
        failedItemIds: failed,
        reason: 'storageFailed',
      };
    }
    cachedSecret = next;
  } catch {
    return {
      kind: 'err',
      resealedItemIds: resealed,
      failedItemIds: failed,
      reason: 'storageFailed',
    };
  }

  return {
    kind: failed.length === 0 ? 'ok' : 'partial',
    resealedItemIds: resealed,
    failedItemIds: failed,
  };
}

/** Permanently delete the vault root secret and both wrapping-key versions. */
export async function deleteRootSecret(): Promise<LocalDeletionResult> {
  await quiesceRootSecretOperations();
  const operations: readonly (() => Promise<unknown>)[] = [
    () => SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_BIOMETRIC),
    () => SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_NO_BIOMETRIC),
    ...[WRAPPING_KEY_ALIAS, WRAPPING_KEY_ALIAS_V2].map(
      (alias) => () => vaultDriver().deleteKey(alias),
    ),
  ];
  const results = await Promise.allSettled(
    operations.map((operation) => Promise.resolve().then(operation)),
  );
  cachedSecret = null;
  hardwareAvailability = null;
  if (results.some((result) => result.status === 'rejected')) {
    return deletionFailed();
  }
  return deletionSucceeded();
}

/** Test-only — wipes the stored secret + in-memory cache. */
export async function resetRootSecretForTesting(): Promise<void> {
  await deleteRootSecret();
}
