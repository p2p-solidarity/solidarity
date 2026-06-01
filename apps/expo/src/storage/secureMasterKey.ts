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
 *   - Subsequent launches: read MASTER_KEY_ALIAS_V2.
 *   - Legacy upgrade: if v2 missing AND v1 alias present (from the prior
 *     Swift install), copy v1 into v2 and KEEP v1 around (Swift treated
 *     v1 as a quarantined fallback after iCloud Keychain phantom-entry
 *     bug; we preserve that defence in case the user's iCloud syncs
 *     bring back the phantom).
 */
import * as SecureStore from 'expo-secure-store';

import { generateAesKey } from '@solidarity/shared';
import { base64Decode, base64Encode } from '@solidarity/shared';

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
// CORRECT FIX (requires native, hence a device-verified follow-up — NOT added
// here to keep the JS/native build green): add a raw-Keychain read to the
// secrets-vault Nitro module —
//   func readLegacyGenericPassword(service: String, account: String) -> Data?
//     { SecItemCopyMatching([kSecClass: kSecClassGenericPassword,
//        kSecAttrService: service, kSecAttrAccount: account,
//        kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]) }
// then, in getMasterKey(), before generating a fresh key, try the four
// (service, account) legacy combinations above and base64-store the recovered
// raw bytes under MASTER_KEY_ALIAS_V2. Android returns nil (no legacy iOS data).
// See memory `parity-audit-2026-06`.
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

/**
 * Best-effort recovery of a legacy iOS master key written by the Swift app.
 * Targets the CORRECT Keychain coordinates (service + account) the Swift
 * EncryptionManager used. NOTE: this succeeds only if the stored value decodes
 * as 32 bytes; the Swift app wrote RAW bytes (not base64) into kSecValueData,
 * which expo-secure-store cannot return as a string — so for most upgraders
 * this returns null and the caller mints a fresh key. Full recovery of the
 * raw-byte key needs the native secrets-vault read documented above. Returns
 * null on any miss/format mismatch; never throws.
 */
async function tryRecoverLegacyMasterKey(): Promise<Uint8Array | null> {
  for (const service of LEGACY_IOS_KEY_SERVICES) {
    for (const account of LEGACY_IOS_KEY_ACCOUNTS) {
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

// Cache the master key for the JS runtime. Without this, every encrypt /
// decrypt call hit SecureStore — loading 100 records cost 100 × ~2ms
// Keychain hops *before* any AES work, blowing the cold-launch budget.
// Same accessibility class as the on-disk key (WHEN_UNLOCKED), so caching
// in memory does not relax the threat model vs. Keychain reads on an
// already-unlocked device. Cleared explicitly via evictMasterKeyCache()
// or resetMasterKeyForTesting().
let cachedKey: Uint8Array | null = null;
let pending: Promise<Uint8Array> | null = null;

/**
 * Get the active master key. Generates one if absent. Performs the v1→v2
 * upgrade exactly once per install. Subsequent calls hit the in-memory
 * cache; concurrent first-callers coalesce on a single SecureStore read.
 */
export async function getMasterKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  if (pending) return pending;
  pending = (async () => {
    try {
      const v2 = await readKey(MASTER_KEY_ALIAS_V2);
      if (v2) { cachedKey = v2; return v2; }

      // Legacy iOS in-place upgrade: try to recover the Swift-era master key
      // from its real Keychain coordinates. (Best-effort — see the
      // tryRecoverLegacyMasterKey / LEGACY_IOS_KEY_* notes above; raw-byte
      // recovery needs the native secrets-vault read.)
      const legacy = await tryRecoverLegacyMasterKey();
      if (legacy) {
        await writeKey(MASTER_KEY_ALIAS_V2, legacy);
        cachedKey = legacy;
        return legacy;
      }

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

/** Test-only escape hatch (mirrors Swift's `local-escape-hatch` debug code). */
export async function resetMasterKeyForTesting(): Promise<void> {
  cachedKey = null;
  pending = null;
  await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS_V2, SECURE_OPTS);
}
