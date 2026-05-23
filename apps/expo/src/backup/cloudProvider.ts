/**
 * Cloud-storage provider — Nitro-backed.
 *
 * After `@solidarity/nitro-cloudkit` landed (May 2026), the simple
 * "upload/download a single encrypted blob" path can sit on top of the
 * real CKContainer (iOS) or Drive REST (Android) Nitro module instead of
 * `react-native-cloud-storage`. The public surface is unchanged so
 * existing consumers (backupManager, gestureAutoBackup, settings/backup)
 * compile without edits.
 *
 * The backup payload still goes through `encryptionManager.encryptJson`
 * before upload — the cloud provider only ever sees ciphertext.
 *
 * The single "backup blob" lives in a single record:
 *   recordType = "AirmeishiBackup"
 *   recordId   = "solidarity.backup.latest"
 *   fields     = JSON-encoded { ciphertextB64: string }
 *
 * On iOS we drop into private DB (no share). On Android the same record
 * lives under `Solidarity/AirmeishiBackup/solidarity.backup.latest`.
 */
import { Platform } from 'react-native';
import { getCloudKit, type CloudKit } from '@solidarity/nitro-cloudkit';

import { decryptJson, encryptJson } from '../storage/encryptionManager';

export type ProviderKind = 'iCloud' | 'googleDrive';

export const DEFAULT_PROVIDER: ProviderKind =
  Platform.OS === 'ios' ? 'iCloud' : 'googleDrive';

const RECORD_TYPE = 'AirmeishiBackup';
const RECORD_ID = 'solidarity.backup.latest';
const CONTAINER_ID = 'iCloud.kidneyweakx.airmeishi';

let activeProvider: ProviderKind = DEFAULT_PROVIDER;
let initialized = false;

async function ensureInitialized(): Promise<CloudKit> {
  const ck = getCloudKit();
  if (!initialized) {
    await ck.initialize(CONTAINER_ID);
    initialized = true;
  }
  return ck;
}

/** Switch the active provider. */
export function setProvider(kind: ProviderKind): void {
  activeProvider = kind;
  // Re-initialise on next call so the Drive token vs iCloud account context
  // pick up the switch cleanly.
  initialized = false;
}

/** Push the Google Sign-In access token into the Nitro module (Android). */
export function setGoogleAccessToken(accessToken: string): void {
  getCloudKit().setDriveAccessToken(accessToken);
}

/** Currently-active provider — convenience accessor for callers. */
export function getActiveProvider(): ProviderKind {
  return activeProvider;
}

interface BackupRecordPayload {
  readonly ciphertextB64: string;
}

/** Upload an arbitrary serialisable value, encrypted with the master key. */
export async function uploadBackup<T>(value: T): Promise<void> {
  const ciphertextB64 = await encryptJson(value);
  const payload: BackupRecordPayload = { ciphertextB64 };
  const ck = await ensureInitialized();
  await ck.saveRecord({
    recordId: RECORD_ID,
    recordType: RECORD_TYPE,
    fields: JSON.stringify(payload),
    modifiedTime: 0,
  });
}

/** Pull the latest backup (if any) from the active provider. */
export async function downloadBackup<T>(): Promise<T | null> {
  try {
    const ck = await ensureInitialized();
    const record = await ck.fetchRecord(RECORD_ID);
    const payload = JSON.parse(record.fields) as BackupRecordPayload;
    if (!payload.ciphertextB64) return null;
    return await decryptJson<T>(payload.ciphertextB64);
  } catch {
    return null;
  }
}

/** Returns the cloud-mtime so the UI can show "last backed up …". */
export async function backupMtime(): Promise<Date | null> {
  try {
    const ck = await ensureInitialized();
    const record = await ck.fetchRecord(RECORD_ID);
    if (record.modifiedTime <= 0) return null;
    return new Date(record.modifiedTime);
  } catch {
    return null;
  }
}
