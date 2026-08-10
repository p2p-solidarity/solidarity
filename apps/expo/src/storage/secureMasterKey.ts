/**
 * Master encryption key — ported from KeychainService.swift's
 * `ensureEncryptionKey()` + the v1→v2 master alias migration.
 *
 * Storage:
 *   iOS    : expo-secure-store wraps Keychain (kSecAttrAccessibleWhenUnlocked).
 *   Android: expo-secure-store wraps EncryptedSharedPreferences via Keystore.
 *
 * Behaviour (parity with Swift):
 *   - First launch: generate 32 random bytes, store under MASTER_KEY_ALIAS_V2.
 *   - Subsequent launches: read MASTER_KEY_ALIAS_V2, unless a Swift legacy
 *     raw key is still present; that key wins and repairs any bad v2 value
 *     minted by the pre-recovery Expo restore path.
 *   - Legacy upgrade: if a Swift-era alias is present, copy it into v2 and
 *     KEEP the legacy item around (Swift treated v1 as a quarantined fallback
 *     after an iCloud Keychain phantom-entry bug; we preserve that defence in
 *     case the user's iCloud syncs bring back the phantom).
 */
import * as SecureStore from 'expo-secure-store';

import { generateAesKey } from '@solidarity/shared';
import { base64Decode, base64Encode } from '@solidarity/shared';

import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from './deletionResult';

const MASTER_KEY_ALIAS_V2 = 'gg.solidarity.master.v2';

// LEGACY iOS master encryption key — the EXACT Keychain coordinates the Swift
// app wrote (solidarity/Services/Utils/EncryptionManager.swift:106-108 +
// Branding.swift). It is a `kSecClassGenericPassword` whose:
//   kSecAttrService = "airmeishi" (legacy) / "solidarity" (renamed build)
//   kSecAttrAccount = "com.kidneyweakx.airmeishi.encryption.key" (legacy) /
//                     "com.kidneyweakx.solidarity.encryption.key"
//   kSecValueData   = the RAW 32 AES bytes (NOT base64, NOT a UTF-8 string)
//
// ⚠️ IN-PLACE-UPGRADE GAP: an existing iOS user upgrading from the Swift app to
// this Expo build cannot have this key recovered by expo-secure-store, because
// SecureStore (a) reads kSecValueData via String(data:encoding:.utf8) — raw AES
// bytes are not valid UTF-8, so the read returns null — and (b) keys items
// under its own service, not "airmeishi"/"solidarity". The PRIOR code here
// looked for `kidneyweakx.airmeishi.encryptionKey`, which the Swift app NEVER
// wrote, so the legacy branch was always a miss → a fresh key was minted and
// the user's encrypted cards/contacts/vault became undecryptable.
//
// Recovery path: before generating a fresh key, try the four legacy
// (service, account) combinations through the secrets-vault Nitro module's
// raw Keychain reader, then base64-store any recovered 32-byte value under
// MASTER_KEY_ALIAS_V2. Android returns an empty buffer (no legacy iOS data).
const LEGACY_IOS_KEY_SERVICES = ['solidarity', 'airmeishi'] as const;
const LEGACY_IOS_KEY_ACCOUNTS = [
  'com.kidneyweakx.solidarity.encryption.key',
  'com.kidneyweakx.airmeishi.encryption.key',
] as const;

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
  requireAuthentication: false,
};

async function readKey(alias: string): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(alias, SECURE_OPTS);
  return stored ? base64Decode(stored) : null;
}

async function readRawLegacyKey(service: string, account: string): Promise<Uint8Array | null> {
  try {
    const { getSecretsVault } = await import('@solidarity/nitro-secrets-vault');
    const raw = await getSecretsVault().readRawKeychainGenericPassword(service, account);
    if (!raw) return null;
    const bytes = new Uint8Array(raw);
    return bytes.length === 32 ? Uint8Array.from(bytes) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort recovery of a legacy iOS master key written by the Swift app.
 * Targets the CORRECT Keychain coordinates (service + account) the Swift
 * EncryptionManager used. Prefer the native raw-byte reader because the Swift
 * app stored raw AES bytes in kSecValueData. The SecureStore/base64 path stays
 * as a compatibility fallback for prerelease Expo builds that wrote the same
 * aliases as strings. Returns null on any miss/format mismatch; never throws.
 */
async function tryRecoverLegacyMasterKey(): Promise<Uint8Array | null> {
  for (const service of LEGACY_IOS_KEY_SERVICES) {
    for (const account of LEGACY_IOS_KEY_ACCOUNTS) {
      const raw = await readRawLegacyKey(service, account);
      if (raw) return raw;
      try {
        const stored = await SecureStore.getItemAsync(account, {
          ...SECURE_OPTS,
          keychainService: service,
        });
        if (!stored) continue;
        const bytes = base64Decode(stored);
        if (bytes.length === 32) return bytes;
      } catch {
        // Wrong service/account, undecodable value, or platform without the
        // item — try the next combination.
      }
    }
  }
  return null;
}

async function writeKey(alias: string, bytes: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(alias, base64Encode(bytes), SECURE_OPTS);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

// Cache the master key for the JS runtime. Without this, every encrypt /
// decrypt call hit SecureStore — loading 100 records cost 100 × ~2ms
// Keychain hops *before* any AES work, blowing the cold-launch budget.
// Same accessibility class as the on-disk key (WHEN_UNLOCKED), so caching
// in memory does not relax the threat model vs. Keychain reads on an
// already-unlocked device. Cleared explicitly via evictMasterKeyCache()
// or resetMasterKeyForTesting().
let cachedKey: Uint8Array | null = null;
let pending: Promise<Uint8Array> | null = null;
let deletionPending: Promise<LocalDeletionResult> | null = null;

/**
 * Get the active master key. Reconciles a Swift-era legacy key into the v2
 * slot before using or generating a key. Subsequent calls hit the in-memory
 * cache; concurrent first-callers coalesce on a single SecureStore read.
 */
export async function getMasterKey(): Promise<Uint8Array> {
  if (deletionPending) {
    throw new Error('Master key deletion is in progress');
  }
  if (cachedKey) return cachedKey;
  if (pending) return pending;
  pending = (async () => {
    try {
      const v2 = await readKey(MASTER_KEY_ALIAS_V2);

      // Legacy iOS in-place upgrade: try to recover the Swift-era master key
      // from its real Keychain coordinates. It must win even when v2 already
      // exists because build 137 could mint and persist the wrong v2 key
      // during a failed restore attempt.
      const legacy = await tryRecoverLegacyMasterKey();
      if (legacy) {
        if (!v2 || !bytesEqual(v2, legacy)) {
          await writeKey(MASTER_KEY_ALIAS_V2, legacy);
        }
        cachedKey = legacy;
        return legacy;
      }

      if (v2) { cachedKey = v2; return v2; }

      const fresh = generateAesKey();
      await writeKey(MASTER_KEY_ALIAS_V2, fresh);
      cachedKey = fresh;
      return fresh;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** Drop the in-memory cache. Safe to call from AppState background hooks. */
export function evictMasterKeyCache(): void {
  cachedKey = null;
}

/**
 * Permanently delete the active encryption key and Swift-era Keychain copies.
 * `deleteItemAsync` queries by service/account without decoding the stored
 * bytes, so it can remove legacy raw AES values that SecureStore cannot read.
 */
async function performMasterKeyDeletion(): Promise<LocalDeletionResult> {
  const inFlightAcquisition = pending;
  if (inFlightAcquisition) {
    // Let an already-issued Keychain write settle before deletion. Clearing
    // `pending` cannot cancel its Promise and would let it recreate the alias
    // after the wipe had reported success.
    await inFlightAcquisition.catch(() => undefined);
  }
  cachedKey = null;
  const operations: Promise<void>[] = [
    SecureStore.deleteItemAsync(MASTER_KEY_ALIAS_V2, SECURE_OPTS),
  ];
  for (const service of LEGACY_IOS_KEY_SERVICES) {
    for (const account of LEGACY_IOS_KEY_ACCOUNTS) {
      operations.push(
        SecureStore.deleteItemAsync(account, {
          ...SECURE_OPTS,
          keychainService: service,
        }),
      );
    }
  }
  const results = await Promise.allSettled(operations);
  if (results.some((result) => result.status === 'rejected')) {
    return deletionFailed();
  }
  return deletionSucceeded();
}

export function deleteMasterKey(): Promise<LocalDeletionResult> {
  if (deletionPending) return deletionPending;
  const operation = performMasterKeyDeletion();
  deletionPending = operation;
  const clear = (): void => {
    if (deletionPending === operation) deletionPending = null;
  };
  operation.then(clear, clear);
  return operation;
}

/** Test-only escape hatch (mirrors Swift's `local-escape-hatch` debug code). */
export async function resetMasterKeyForTesting(): Promise<void> {
  await deleteMasterKey();
}
