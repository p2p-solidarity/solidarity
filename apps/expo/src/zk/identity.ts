/**
 * SemaphoreIdentity — port of solidarity/Services/ZK/SemaphoreIdentityManager.swift.
 *
 * All identity material stays inside the Nitro module (iOS Keychain /
 * Android EncryptedSharedPreferences). This file is the JS-facing API
 * the React tree consumes via the zustand coordinator.
 *
 * Threading model:
 *   • Reads (`commitmentSync`) are O(1) — they just pull the cached
 *     commitment out of the native singleton, so the Renderer never
 *     stalls a frame.
 *   • Writes (`loadOrCreate`, `delete`, `importPrivateKey`) are async
 *     because they cross the JSI bridge + hit secure storage.
 *
 * Keychain alias: `com.kidneyweakx.solidarity.semaphore.identity`
 *   (must match `solidarity/Services/Utils/Branding.swift:27` —
 *    `AppBranding.currentSemaphoreIdentityTag`).
 */
import { loadSemaphoreNative } from './nativeBridge';
import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from '@/storage/deletionResult';

const KEYCHAIN_ALIAS = 'com.kidneyweakx.solidarity.semaphore.identity';

export interface IdentitySnapshot {
  /** Decimal-string field-element commitment, or null when not initialised. */
  readonly commitment: string | null;
  /** True iff the underlying native module is linked + functional. */
  readonly proofsSupported: boolean;
}

const EMPTY: IdentitySnapshot = { commitment: null, proofsSupported: false };

/**
 * Try to load the persisted identity; if nothing's stored, generate a
 * fresh one. Mirrors Swift's `loadOrCreateIdentity()`. Returns a snapshot
 * so callers can update their zustand store atomically.
 */
export async function loadOrCreateIdentity(): Promise<IdentitySnapshot> {
  const native = await loadSemaphoreNative();
  if (!native) return EMPTY;

  const loaded = await native.loadIdentityFromKeychain(KEYCHAIN_ALIAS);
  if (loaded) {
    return { commitment: native.getCommitment(), proofsSupported: true };
  }
  const commitment = await native.generateIdentity();
  return { commitment, proofsSupported: true };
}

/**
 * Snapshot of the *currently loaded* identity. Returns the empty state
 * when nothing is loaded yet, so the UI can render its empty visuals
 * without waiting on the bridge.
 */
export async function currentIdentity(): Promise<IdentitySnapshot> {
  const native = await loadSemaphoreNative();
  if (!native) return EMPTY;
  const commitment = native.getCommitment();
  return {
    commitment: commitment === '' ? null : commitment,
    proofsSupported: true,
  };
}

/**
 * Permanently delete the local ZK identity. Caller is responsible for
 * the biometric gate (mirrors Swift's
 * `BiometricGatekeeper.shared.authorizeIfRequired(.deleteZKIdentity)`).
 */
export async function deleteIdentity(): Promise<void> {
  const native = await loadSemaphoreNative();
  if (!native) return;
  await native.deleteIdentity();
}

/** Strict production-wipe variant: unavailable native storage is failure. */
export async function deleteIdentityForLocalWipe(): Promise<LocalDeletionResult> {
  try {
    const native = await loadSemaphoreNative();
    if (!native) return deletionFailed();
    await native.deleteIdentity();
    return deletionSucceeded();
  } catch {
    return deletionFailed();
  }
}

/**
 * Export the raw 32-byte private key so the caller can stash it in the
 * encrypted iCloud / Drive backup blob. Throws if nothing is loaded.
 * Caller MUST biometric-gate this call.
 */
export async function exportPrivateKey(): Promise<Uint8Array> {
  const native = await loadSemaphoreNative();
  if (!native) throw new Error('Semaphore native module unavailable');
  const ab = await native.exportPrivateKey();
  return new Uint8Array(ab);
}

/**
 * Replace the active identity with one derived from `privateKey`. Returns
 * the new commitment so callers can update their zustand store.
 */
export async function importPrivateKey(privateKey: Uint8Array): Promise<string> {
  const native = await loadSemaphoreNative();
  if (!native) throw new Error('Semaphore native module unavailable');
  // ArrayBuffer.copyOf(privateKey) — must hand the native side a proper
  // ArrayBuffer (Uint8Array's underlying buffer may be a SharedArrayBuffer
  // sub-view on some engines).
  const buffer = new Uint8Array(privateKey).buffer;
  return native.importPrivateKey(buffer);
}

/**
 * Test-only helper. Mirrors Swift's `Identity(privateKey:)` constructor —
 * deterministic identity from a 32-byte seed. Used in parity fixtures.
 */
export async function identityFromSeed(seed: Uint8Array): Promise<string> {
  const native = await loadSemaphoreNative();
  if (!native) throw new Error('Semaphore native module unavailable');
  const buffer = new Uint8Array(seed).buffer;
  return native.identityFromSeed(buffer);
}

/** Keychain alias accessor — keeps the literal out of UI code. */
export const SEMAPHORE_IDENTITY_KEYCHAIN_ALIAS = KEYCHAIN_ALIAS;
