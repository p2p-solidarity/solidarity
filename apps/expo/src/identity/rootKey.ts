/**
 * rootKey.ts — seed-derived root identity (BIP-39 mnemonic -> HKDF ->
 * P-256 scalar -> did:key), per 04-plan Phase A1 task A1.4. The mnemonic
 * derivation itself lives in `@solidarity/shared/derive.ts` (`HKDF_INFO_ROOT`
 * = 'solidarity-root-v1'); this module owns App-side storage, the Face-ID
 * gate, and the `Signer` contract from `@solidarity/shared/jws.ts`.
 *
 * ── Relationship to the EXISTING production identity (read before touching
 *    `useIdentityCoordinator` / `useActiveDid` / any existing screen) ──────
 *
 * `apps/expo/src/keychain/signingKey.ts` already provisions a DIFFERENT
 * did:key (`ensureSigningKey()` / `didKeyForCurrentIdentity()`), backed by
 * the SpruceID Nitro module (`@solidarity/nitro-spruce-did`). That key is:
 *   - randomly generated natively (not derivable from a mnemonic — the
 *     private material never leaves the platform Keychain/Keystore),
 *   - ALREADY stored as an iCloud-Keychain-synchronizable item on iOS
 *     (`kSecAttrSynchronizable = true`, no biometry ACL — see
 *     `nitro-modules/spruce-did/ios/SpruceDidKeyStore.swift:119`),
 *   - the identity every existing screen reads today (`dids.tsx`,
 *     `useIdentityCoordinator`, card/credential signing, challenge
 *     responses, …).
 *
 * The root key in THIS module is a SEPARATE, ADDITIVE identity: its whole
 * point is App<->Web portability via a human-writable mnemonic, which the
 * SpruceID key structurally cannot offer. Task A1.4 does not migrate any
 * existing screen onto this root key — that convergence (if any) is a
 * decision for a later phase once the Verify-tab / profile-record surfaces
 * that actually consume `getRootDid()` exist (04-plan Phase A2+). Until
 * then both identities coexist; nothing here reads or writes
 * `solidarity.master.v2`.
 *
 * ── Storage (today) ─────────────────────────────────────────────────────
 *
 * The mnemonic is ALWAYS persisted locally via `expo-secure-store`
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) regardless of the user's backup
 * choice — `RootKeyStorage` above. That local copy is what the mnemonic
 * ceremony in `src/onboarding/steps/BackupStep.tsx` shows/reveals, and
 * what every `createFromFreshMnemonic` / `importFromMnemonic` caller reads
 * back through `getRootDid` / `getRootSigner`.
 *
 * `enableICloudBackup()` (below) is a SEPARATE, ADDITIVE write: it copies
 * the already-persisted mnemonic into an iCloud-Keychain-SYNCHRONIZABLE
 * item via `@solidarity/nitro-secrets-vault`'s `setSynchronizableItem`
 * (iOS: `kSecAttrSynchronizable=true`, `kSecAttrAccessibleWhenUnlocked`, no
 * biometry ACL — see that module's doc; task A1.5). It does NOT replace or
 * gate the local copy — the local copy is the durable source of truth this
 * module reads from, and it is what backs the mnemonic-ceremony fallback
 * when a synchronizable write fails (see that function's doc for the exact
 * failure contract). `usePreferences().rootKeySyncChoice` is set to
 * `'icloud'` by the CALLER (`BackupStep.tsx`) only after
 * `enableICloudBackup()` resolves `ok(...)` — never on intent alone.
 *
 * Face ID gating happens at the SIGNING/EXPORT CALL layer
 * (`requireBiometric('sign'|'export')`), never via a Keychain ACL — this is
 * required regardless of the sync gap (a synchronizable item can't carry a
 * biometry access-control instance either), so the design does not change
 * once real sync lands.
 *
 * The plaintext mnemonic is NEVER written to MMKV and NEVER logged. It is
 * held in memory only for the duration of a create/import/export ceremony
 * (the caller's responsibility once `revealMnemonicForExport` /
 * `createFromFreshMnemonic` return it) and persisted only via
 * `RootKeyStorage`, which is SecureStore-backed by default and swappable
 * for tests (`__setRootKeyStorageForTesting`).
 */
import { p256 } from '@noble/curves/nist.js';
// Type-only — the runtime binding is loaded lazily (see `loadSecureStore`)
// so importing this module in tests never eagerly pulls in the real
// `expo-secure-store` (which transitively requires React Native's Flow-
// syntax entry point; bun's test parser can't load it). Every real call
// site loads it on first use and the module is cached by the runtime after
// that, so this costs nothing beyond the first invocation.
import type * as SecureStoreNS from 'expo-secure-store';

import {
  HKDF_INFO_ROOT,
  deriveP256Scalar,
  didKeyFromPublicKey,
  err,
  generateMnemonic,
  ok,
  publicKeyFromPrivate,
  type Result,
  type Signer,
} from '@solidarity/shared';

const MNEMONIC_ALIAS = 'gg.solidarity.rootkey.mnemonic.v1';

async function loadSecureStore(): Promise<typeof SecureStoreNS> {
  return import('expo-secure-store');
}

function secureOpts(SecureStore: typeof SecureStoreNS): SecureStoreNS.SecureStoreOptions {
  return {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    requireAuthentication: false,
  };
}

export type RootKeyError =
  | { readonly kind: 'notProvisioned' }
  | { readonly kind: 'invalidMnemonic'; readonly message: string }
  | { readonly kind: 'biometricDenied' }
  | { readonly kind: 'storageFailed'; readonly message: string };

export interface RootKeyStorage {
  readonly getMnemonic: () => Promise<string | null>;
  readonly setMnemonic: (mnemonic: string) => Promise<void>;
  readonly deleteMnemonic: () => Promise<void>;
}

const defaultStorage: RootKeyStorage = {
  getMnemonic: async () => {
    const SecureStore = await loadSecureStore();
    return SecureStore.getItemAsync(MNEMONIC_ALIAS, secureOpts(SecureStore));
  },
  setMnemonic: async (mnemonic) => {
    const SecureStore = await loadSecureStore();
    await SecureStore.setItemAsync(MNEMONIC_ALIAS, mnemonic, secureOpts(SecureStore));
  },
  deleteMnemonic: async () => {
    const SecureStore = await loadSecureStore();
    await SecureStore.deleteItemAsync(MNEMONIC_ALIAS, secureOpts(SecureStore));
  },
};

// ── iCloud Keychain sync (task A1.5) ────────────────────────────────────
//
// Separate alias namespace from `MNEMONIC_ALIAS` above — the synchronizable
// item lives in a DIFFERENT keychain service inside `secrets-vault`
// (`gg.solidarity.secretsvault.sync`, see that module's iOS implementation)
// so a delete of one can never collide with the other.
const ICLOUD_SYNC_ALIAS = 'gg.solidarity.rootkey.mnemonic.icloud.v1';

export interface RootKeySyncStorage {
  readonly setSyncedMnemonic: (mnemonic: string) => Promise<void>;
  readonly deleteSyncedMnemonic: () => Promise<void>;
}

/**
 * Lazy-loaded for the same reason as `loadSecureStore` above: importing
 * `@solidarity/nitro-secrets-vault` eagerly would pull in
 * `react-native-nitro-modules`' native binding at module-load time, which
 * has no counterpart in the bun test runtime. Every real call site resolves
 * it on first use; tests inject `__setRootKeySyncStorageForTesting` instead.
 */
async function loadSecretsVault(): Promise<{
  readonly setSynchronizableItem: (alias: string, value: string) => Promise<void>;
  readonly deleteSynchronizableItem: (alias: string) => Promise<void>;
}> {
  const { getSecretsVault } = await import('@solidarity/nitro-secrets-vault');
  return getSecretsVault();
}

const defaultSyncStorage: RootKeySyncStorage = {
  setSyncedMnemonic: async (mnemonic) => {
    const vault = await loadSecretsVault();
    await vault.setSynchronizableItem(ICLOUD_SYNC_ALIAS, mnemonic);
  },
  deleteSyncedMnemonic: async () => {
    const vault = await loadSecretsVault();
    await vault.deleteSynchronizableItem(ICLOUD_SYNC_ALIAS);
  },
};

let activeStorage: RootKeyStorage = defaultStorage;

/**
 * Test-only override — inject an in-memory storage mock. Pass `null` to
 * restore the default expo-secure-store-backed implementation.
 */
export function __setRootKeyStorageForTesting(storage: RootKeyStorage | null): void {
  activeStorage = storage ?? defaultStorage;
}

let activeSyncStorage: RootKeySyncStorage = defaultSyncStorage;

/**
 * Test-only override — inject an in-memory sync-storage mock. Pass `null`
 * to restore the default secrets-vault-backed implementation.
 */
export function __setRootKeySyncStorageForTesting(storage: RootKeySyncStorage | null): void {
  activeSyncStorage = storage ?? defaultSyncStorage;
}

/**
 * Face ID gate — same lazy-load reasoning as `loadSecureStore` above:
 * `@/keychain/biometric` transitively requires `expo-local-authentication`,
 * which has the same React-Native-Flow-parse problem when unmocked. Real
 * call sites resolve it on first use; tests inject a fake gate instead of
 * needing a global `mock.module` (which would otherwise leak into every
 * other test file in the same `bun test` process — see the module doc).
 */
export type BiometricGate = (reason: 'sign' | 'export') => Promise<boolean>;

async function defaultBiometricGate(reason: 'sign' | 'export'): Promise<boolean> {
  const { requireBiometric } = await import('@/keychain/biometric');
  return requireBiometric(reason);
}

let activeBiometricGate: BiometricGate = defaultBiometricGate;

/** Test-only override. Pass `null` to restore the real Face ID gate. */
export function __setRootKeyBiometricGateForTesting(gate: BiometricGate | null): void {
  activeBiometricGate = gate ?? defaultBiometricGate;
}

function toStorageError(e: unknown): RootKeyError {
  return { kind: 'storageFailed', message: e instanceof Error ? e.message : String(e) };
}

function normalizeMnemonic(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Pure — derive the root did:key from a mnemonic. No storage/IO, so this is
 * safe to call speculatively (e.g. identity-export's "preview the did before
 * committing to an import" step) without side effects. Never throws: a
 * malformed/checksum-invalid mnemonic (see `deriveP256Scalar`'s RangeError
 * contract) is converted to `err({kind:'invalidMnemonic'})`.
 */
export function deriveDidFromMnemonic(mnemonic: string): Result<string, RootKeyError> {
  try {
    const scalar = deriveP256Scalar(normalizeMnemonic(mnemonic), HKDF_INFO_ROOT);
    return ok(didKeyFromPublicKey(publicKeyFromPrivate(scalar)));
  } catch (e) {
    return err({ kind: 'invalidMnemonic', message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Onboarding: mint a fresh 24-word mnemonic, persist it, and return both the
 * mnemonic (for the backup ceremony / consent screen — caller must not log
 * or persist it elsewhere) and the resulting did:key.
 */
export async function createFromFreshMnemonic(): Promise<
  Result<{ readonly mnemonic: string; readonly did: string }, RootKeyError>
> {
  const mnemonic = generateMnemonic();
  const didResult = deriveDidFromMnemonic(mnemonic);
  if (!didResult.ok) return didResult;
  try {
    await activeStorage.setMnemonic(mnemonic);
  } catch (e) {
    return err(toStorageError(e));
  }
  return ok({ mnemonic, did: didResult.value });
}

/**
 * Import an existing mnemonic (free App<->Web portability): derive + persist
 * it as the active root. Idempotent — importing the same mnemonic twice
 * yields the same did and simply re-persists the identical value.
 */
export async function importFromMnemonic(
  mnemonic: string
): Promise<Result<{ readonly did: string }, RootKeyError>> {
  const normalized = normalizeMnemonic(mnemonic);
  const didResult = deriveDidFromMnemonic(normalized);
  if (!didResult.ok) return didResult;
  try {
    await activeStorage.setMnemonic(normalized);
  } catch (e) {
    return err(toStorageError(e));
  }
  return ok({ did: didResult.value });
}

/** Resolve the currently-provisioned root did:key. */
export async function getRootDid(): Promise<Result<string, RootKeyError>> {
  let mnemonic: string | null;
  try {
    mnemonic = await activeStorage.getMnemonic();
  } catch (e) {
    return err(toStorageError(e));
  }
  if (!mnemonic) return err({ kind: 'notProvisioned' });
  return deriveDidFromMnemonic(mnemonic);
}

/** Whether a root key has been provisioned on this device. */
export async function hasRootKey(): Promise<boolean> {
  try {
    return (await activeStorage.getMnemonic()) !== null;
  } catch {
    return false;
  }
}

/**
 * Face-ID-gated `Signer` for the root key (contract: `@solidarity/shared`'s
 * `Signer` — receives the 32-byte SHA-256 digest of the signing input,
 * returns raw 64-byte r||s, `{prehash:false}` since the digest is already
 * the message representative — see `jws.ts` module doc). The OUTER Result
 * only reflects "is a root key provisioned"; the signer itself gates and
 * may reject (matches `keychain/signingKey.ts`'s `signJwt`/`signRawEs256`
 * contract, which also throws rather than returning Result on denial,
 * since `Signer`'s shape is fixed by `@solidarity/shared`).
 *
 * @warning The returned `Signer` REJECTS (throws) on biometric denial — it
 * does not return a `Result`. `Signer`'s shape is fixed by
 * `@solidarity/shared`'s `jws.ts` (used directly by `signCompact`), so this
 * function cannot change that contract on its own. Every call site —
 * including future `signCompact(...)` wrappers built on top of this
 * signer — MUST wrap the call in try/catch (or handle the rejected
 * promise) rather than assume it always resolves. An uncaught rejection
 * here is an unhandled promise rejection, not a typed error.
 */
export async function getRootSigner(): Promise<Result<Signer, RootKeyError>> {
  let mnemonic: string | null;
  try {
    mnemonic = await activeStorage.getMnemonic();
  } catch (e) {
    return err(toStorageError(e));
  }
  if (!mnemonic) return err({ kind: 'notProvisioned' });

  let scalar: Uint8Array;
  try {
    scalar = deriveP256Scalar(mnemonic, HKDF_INFO_ROOT);
  } catch (e) {
    return err({ kind: 'invalidMnemonic', message: e instanceof Error ? e.message : String(e) });
  }

  const signer: Signer = async (digest: Uint8Array): Promise<Uint8Array> => {
    const allowed = await activeBiometricGate('sign');
    if (!allowed) throw new Error('biometric authentication required');
    // `{ prehash: false }` — `digest` is already the single-SHA-256 RFC 7515
    // signing-input digest computed by `signCompact`; @noble/curves'
    // default (`prehash: true`) would hash it a second time (the exact bug
    // tracked for `identity/jwt.ts` under 04-plan task A10.4 — this signer
    // must not repeat it).
    return p256.sign(digest, scalar, { prehash: false });
  };
  return ok(signer);
}

/**
 * Export ceremony: Face-ID gate, then reveal the plaintext mnemonic. The
 * caller (settings/identity-export.tsx) is responsible for showing the
 * screenshot warning and never persisting the value outside this module's
 * own SecureStore-backed storage.
 */
export async function revealMnemonicForExport(): Promise<Result<string, RootKeyError>> {
  const allowed = await activeBiometricGate('export');
  if (!allowed) return err({ kind: 'biometricDenied' });
  let mnemonic: string | null;
  try {
    mnemonic = await activeStorage.getMnemonic();
  } catch (e) {
    return err(toStorageError(e));
  }
  if (!mnemonic) return err({ kind: 'notProvisioned' });
  return ok(mnemonic);
}

/**
 * iCloud Keychain backup (task A1.5): copy the ALREADY-PROVISIONED local
 * mnemonic into a synchronizable Keychain item via `secrets-vault`'s
 * `setSynchronizableItem` (iOS: `kSecAttrSynchronizable=true`,
 * `kSecAttrAccessibleWhenUnlocked`, no biometry ACL — see that module's
 * doc). Requires `createFromFreshMnemonic` / `importFromMnemonic` to have
 * already run (returns `err({kind:'notProvisioned'})` otherwise, WITHOUT
 * touching sync storage).
 *
 * On any failure — including the unconditional rejection Android's
 * `secrets-vault` implementation returns for every synchronizable-item
 * call, since Android has no iCloud Keychain — this returns
 * `err({kind:'storageFailed', ...})` and leaves the local mnemonic
 * untouched, so the caller's mnemonic-ceremony fallback (`BackupStep.tsx`'s
 * `declineToMnemonic`) always has a valid mnemonic to reveal.
 *
 * @warning Callers MUST NOT record `rootKeySyncChoice = 'icloud'` (or any
 * other "sync is on" state) unless this resolves `ok(...)` — recording
 * intent before a confirmed write violates CLAUDE.md rule 8 (no fake data)
 * and is the exact bug task A1.5 exists to fix (see rootKey.ts's module
 * doc).
 */
export async function enableICloudBackup(): Promise<Result<void, RootKeyError>> {
  let mnemonic: string | null;
  try {
    mnemonic = await activeStorage.getMnemonic();
  } catch (e) {
    return err(toStorageError(e));
  }
  if (!mnemonic) return err({ kind: 'notProvisioned' });
  try {
    await activeSyncStorage.setSyncedMnemonic(mnemonic);
  } catch (e) {
    return err(toStorageError(e));
  }
  return ok(undefined);
}

/**
 * Delete the persisted root key. Used by tests and by a future rotate/reset
 * flow. Also best-effort deletes the synchronizable iCloud item (if any)
 * so a reset never leaves an orphaned synced mnemonic behind — swallowed on
 * failure (Android's `secrets-vault` implementation always rejects here,
 * and an iOS delete of a missing item is already a no-op at the native
 * layer, so a real failure here is not actionable for the caller).
 */
export async function deleteRootKey(): Promise<void> {
  await activeStorage.deleteMnemonic();
  try {
    await activeSyncStorage.deleteSyncedMnemonic();
  } catch {
    // best-effort — see doc above.
  }
}
