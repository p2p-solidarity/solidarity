/**
 * Cloud-storage provider abstraction — mirrors Swift BackupManager.swift's
 * iCloud / local fallback shape, extended for cross-platform Drive.
 *
 * Choice matrix (per user decision 2026-05-24):
 *   iOS:     iCloud (default) OR Google Drive (opt-in via Settings)
 *   Android: Google Drive (only option; no iCloud on Android)
 *
 * Uses react-native-cloud-storage, which natively supports both
 * iCloudDocuments (iOS ubiquity container) and Google Drive AppData
 * (cross-platform, requires Google Sign-In on Android).
 *
 * Files at rest are ALWAYS encrypted by encryptionManager.encryptJson before
 * upload — the cloud provider sees opaque ciphertext. Compromise of the
 * cloud account does NOT leak the user's identity card.
 */
import { Platform } from 'react-native';
import {
  CloudStorage,
  CloudStorageProvider,
  CloudStorageScope,
} from 'react-native-cloud-storage';

import { decryptJson, encryptJson } from '../storage/encryptionManager';

export type ProviderKind = 'iCloud' | 'googleDrive';

export const DEFAULT_PROVIDER: ProviderKind = Platform.OS === 'ios' ? 'iCloud' : 'googleDrive';

/** Switch the active provider. Caller must have completed any auth (e.g. Google Sign-In). */
export function setProvider(kind: ProviderKind): void {
  CloudStorage.setProvider(
    kind === 'iCloud' ? CloudStorageProvider.ICloud : CloudStorageProvider.GoogleDrive
  );
}

/** Push the Google Sign-In access token into the cloud-storage instance. */
export function setGoogleAccessToken(accessToken: string): void {
  CloudStorage.setProviderOptions({ accessToken });
}

const BACKUP_PATH = '/solidarity/backup.enc';
const SCOPE = CloudStorageScope.AppData;

/** Upload an arbitrary serialisable value, encrypted with the master key. */
export async function uploadBackup<T>(value: T): Promise<void> {
  const ciphertextB64 = await encryptJson(value);
  await CloudStorage.writeFile(BACKUP_PATH, ciphertextB64, SCOPE);
}

/** Pull the latest backup (if any) from the active provider. */
export async function downloadBackup<T>(): Promise<T | null> {
  const exists = await CloudStorage.exists(BACKUP_PATH, SCOPE);
  if (!exists) return null;
  const ciphertextB64 = await CloudStorage.readFile(BACKUP_PATH, SCOPE);
  return await decryptJson<T>(ciphertextB64);
}

/** Returns the cloud-mtime so the UI can show "last backed up …". */
export async function backupMtime(): Promise<Date | null> {
  const exists = await CloudStorage.exists(BACKUP_PATH, SCOPE);
  if (!exists) return null;
  const stat = await CloudStorage.stat(BACKUP_PATH, SCOPE);
  return stat.mtime;
}
