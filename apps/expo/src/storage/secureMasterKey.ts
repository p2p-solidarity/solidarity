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
const MASTER_KEY_ALIAS_V1 = 'kidneyweakx.airmeishi.encryptionKey';

const SECURE_OPTS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED,
  requireAuthentication: false,
};

async function readKey(alias: string): Promise<Uint8Array | null> {
  const stored = await SecureStore.getItemAsync(alias, SECURE_OPTS);
  return stored ? base64Decode(stored) : null;
}

async function writeKey(alias: string, bytes: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(alias, base64Encode(bytes), SECURE_OPTS);
}

/**
 * Get the active master key. Generates one if absent. Performs the v1→v2
 * upgrade exactly once per install.
 */
export async function getMasterKey(): Promise<Uint8Array> {
  const v2 = await readKey(MASTER_KEY_ALIAS_V2);
  if (v2) return v2;

  const v1 = await readKey(MASTER_KEY_ALIAS_V1);
  if (v1) {
    await writeKey(MASTER_KEY_ALIAS_V2, v1);
    return v1;
  }

  const fresh = generateAesKey();
  await writeKey(MASTER_KEY_ALIAS_V2, fresh);
  return fresh;
}

/** Test-only escape hatch (mirrors Swift's `local-escape-hatch` debug code). */
export async function resetMasterKeyForTesting(): Promise<void> {
  await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS_V2, SECURE_OPTS);
  await SecureStore.deleteItemAsync(MASTER_KEY_ALIAS_V1, SECURE_OPTS);
}
