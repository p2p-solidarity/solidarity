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
 * ── Storage ceiling (today) ────────────────────────────────────────────
 *
 * The mnemonic is persisted via `expo-secure-store`, LOCAL-ONLY
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY` — expo-secure-store has no
 * `kSecAttrSynchronizable` option at all, see `SecureStoreOptions` in its
 * type defs). This means the "back up via iCloud Keychain" consent offered
 * in `src/onboarding/steps/BackupStep.tsx` records an *intent* (a
 * preference flag, `usePreferences().rootKeySyncChoice`) today, not yet
 * real iCloud sync of this particular item — see that screen's docstring
 * and the task report for the two concrete options to close the gap
 * (`react-native-keychain`, or a small `SecItemAdd`
 * `kSecAttrSynchronizable=true` addition to `nitro-modules/secrets-vault`,
 * modelled directly on the working precedent above).
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

let activeStorage: RootKeyStorage = defaultStorage;

/**
 * Test-only override — inject an in-memory storage mock. Pass `null` to
 * restore the default expo-secure-store-backed implementation.
 */
export function __setRootKeyStorageForTesting(storage: RootKeyStorage | null): void {
  activeStorage = storage ?? defaultStorage;
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

/** Delete the persisted root key. Used by tests and by a future rotate/reset flow. */
export async function deleteRootKey(): Promise<void> {
  await activeStorage.deleteMnemonic();
}
