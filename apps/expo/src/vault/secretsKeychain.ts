/**
 * Vault root secret — the 32-byte AES key that seals every vault item.
 *
 * Mirrors solidarity/Services/Vault/VaultSecretsKeychain.swift +
 * FileEncryptionService.swift's `getOrCreateVaultKey()`. The key never leaves
 * the device storage:
 *
 *   iOS    : expo-secure-store wraps Keychain (kSecAttrAccessible =
 *            WhenUnlockedThisDeviceOnly). With `requireAuthentication: true`
 *            the underlying SecAccessControl gates each read on Face ID /
 *            Touch ID (or device passcode on fallback).
 *   Android: expo-secure-store wraps EncryptedSharedPreferences via Keystore.
 *            `requireAuthentication: true` triggers BiometricPrompt.
 *
 * Two access modes are exposed so callers can pick the right ergonomic:
 *   - `getOrCreateRootSecret({ biometric: true  })` — sensitive ops (shard
 *     distribution, recovery, export). Resolves to `Result.err('biometric…')`
 *     when the user denies/cancels the prompt.
 *   - `getOrCreateRootSecret({ biometric: false })` — background sync /
 *     unlocked-foreground reads. Returns the bytes without a prompt as long
 *     as the device is unlocked.
 *
 * `rotateRootSecret` re-seals every existing vault item under a new key in a
 * single best-effort pass and surfaces progress through the optional
 * `onProgress` callback. Failure to re-seal one item does NOT abort the
 * whole rotation — the failing item is returned in the result so the caller
 * can offer the user a retry.
 */
import * as SecureStore from 'expo-secure-store';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  generateAesKey,
} from '@solidarity/shared';

import { requireBiometric } from '@/keychain/biometric';
import * as FileSystem from 'expo-file-system/legacy';

import type { VaultItem } from './store';

/** Storage alias — distinct from the masterKey aliases used by MMKV/backup. */
const ROOT_SECRET_ALIAS = 'gg.solidarity.vault.rootSecret.v1';

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

function opts(mode: AccessMode): SecureStore.SecureStoreOptions {
  return mode === 'biometric' ? SECURE_OPTS_BIOMETRIC : SECURE_OPTS_NO_BIOMETRIC;
}

/**
 * Read the root secret with the requested access mode. Generates a fresh
 * 32-byte key on first call. The biometric mode goes through
 * `requireBiometric('exchange')` first so the failure surface is identical
 * to every other Face ID-gated path (matches CLAUDE.md Sec rules).
 */
export async function getOrCreateRootSecret(
  mode: AccessMode = 'biometric'
): Promise<RootSecretResult> {
  if (cachedSecret && mode === 'silent') {
    return { kind: 'ok', bytes: cachedSecret };
  }

  if (mode === 'biometric') {
    const allowed = await requireBiometric('exchange');
    if (!allowed) return { kind: 'err', reason: 'biometricDenied' };
  }

  try {
    const stored = await SecureStore.getItemAsync(ROOT_SECRET_ALIAS, opts(mode));
    if (stored) {
      const bytes = base64Decode(stored);
      cachedSecret = bytes;
      return { kind: 'ok', bytes };
    }
    const fresh = generateAesKey();
    await SecureStore.setItemAsync(
      ROOT_SECRET_ALIAS,
      base64Encode(fresh),
      opts(mode)
    );
    cachedSecret = fresh;
    return { kind: 'ok', bytes: fresh };
  } catch {
    return { kind: 'err', reason: 'storageFailed' };
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
export async function rotateRootSecret(
  items: readonly VaultItem[],
  onProgress?: (p: RotationProgress) => void
): Promise<RotationResult> {
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
    onProgress?.({ processed: index, total: items.length, currentItemId: item.id });
    try {
      const sealedB64 = await FileSystem.readAsStringAsync(item.encryptedPath, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const plaintext = aesGcmOpen(current.bytes, base64Decode(sealedB64));
      const resealedBytes = aesGcmSeal(next, plaintext);
      await FileSystem.writeAsStringAsync(
        item.encryptedPath,
        base64Encode(resealedBytes),
        { encoding: FileSystem.EncodingType.Base64 }
      );
      resealed.push(item.id);
    } catch {
      failed.push(item.id);
    }
  }
  onProgress?.({ processed: items.length, total: items.length });

  if (items.length > 0 && resealed.length === 0) {
    return { kind: 'err', resealedItemIds: [], failedItemIds: failed, reason: 'storageFailed' };
  }

  try {
    await SecureStore.setItemAsync(
      ROOT_SECRET_ALIAS,
      base64Encode(next),
      SECURE_OPTS_BIOMETRIC
    );
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

/** Test-only — wipes the stored secret + in-memory cache. */
export async function resetRootSecretForTesting(): Promise<void> {
  await SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_BIOMETRIC).catch(
    () => undefined
  );
  await SecureStore.deleteItemAsync(ROOT_SECRET_ALIAS, SECURE_OPTS_NO_BIOMETRIC).catch(
    () => undefined
  );
  cachedSecret = null;
}
