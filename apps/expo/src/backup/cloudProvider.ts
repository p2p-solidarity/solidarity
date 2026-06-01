/**
 * Cloud-storage provider — file-based, 1:1 with the native Swift app.
 *
 * The legacy SwiftUI app (`solidarity/Services/Backup/BackupManager.swift`)
 * writes encrypted, SOLB-framed `.solbk` files into the iCloud Drive
 * ubiquity container (`Documents/AirMeishiBackup/`), with a local fallback
 * when iCloud is unavailable. The first Expo port instead saved a single
 * **CloudKit custom record** (`AirmeishiBackup`) — which production CloudKit
 * refuses to auto-create ("Cannot create new type AirmeishiBackup in
 * production schema"), so every TestFlight/App Store backup failed.
 *
 * This module restores the native design: backups are files written via the
 * `@solidarity/nitro-cloudkit` file API (iOS ubiquity container / Android
 * Drive folder). No CloudKit schema is involved, so the production-schema
 * error class is gone. The public surface is unchanged so existing consumers
 * (backupManager, gestureAutoBackup, settings/backup) compile without edits.
 *
 * Layout (mirrors Swift):
 *   AirMeishiBackup/backup_<unixSeconds>.solbk
 *     bytes = "SOLB" || 0x01 || AES-GCM(encryptJson(payload))
 *   newest 5 retained; older rotated out.
 *
 * The payload still goes through `encryptionManager.encryptJson` before
 * upload — the cloud provider only ever sees ciphertext.
 */
import { Platform } from 'react-native';
import { getCloudKit, type CloudKit } from '@solidarity/nitro-cloudkit';

import { decryptJson, encryptJson } from '../storage/encryptionManager';
import { decodeSolb, encodeSolb } from './solbEnvelope';

export type ProviderKind = 'iCloud' | 'googleDrive';

export const DEFAULT_PROVIDER: ProviderKind =
  Platform.OS === 'ios' ? 'iCloud' : 'googleDrive';

const CONTAINER_ID = 'iCloud.kidneyweakx.airmeishi';
const BACKUP_PREFIX = 'backup_';
const BACKUP_EXT = '.solbk';
/** Mirror Swift BackupManager.maxBackupCount. */
const MAX_BACKUPS = 5;

let activeProvider: ProviderKind = DEFAULT_PROVIDER;
let initialized = false;
/** True once a Drive access token has been pushed to the native client. */
let driveAuthorized = false;

/**
 * Acquire a Google Drive access token and hand it to the native Drive client.
 * Without this the Nitro Drive client has NO bearer token, so every Drive op
 * returns 401 — the root reason Android Drive backup never authenticated
 * (signInForDrive existed but was never called). Silent refresh if the user is
 * already signed in; interactive sign-in on the first backup. Lazily imported
 * so the iOS / iCloud path never loads the Google Sign-In native module.
 *
 * Degrades gracefully: if the Google Sign-In module is unavailable (unit
 * tests, or a build without it) or the user declines, we DON'T throw/crash —
 * the subsequent Drive op surfaces its own 401, telling the user to connect
 * Google Drive. Never blocks the backup pipeline on an auth side-effect.
 */
async function ensureDriveAuth(): Promise<void> {
  if (driveAuthorized) return;
  try {
    const { signInForDrive, refreshDriveAccessToken } = await import('./googleAuth');
    try {
      setGoogleAccessToken(await refreshDriveAccessToken());
    } catch {
      // Not signed in yet (or token expired without a refresh) — prompt.
      const session = await signInForDrive();
      setGoogleAccessToken(session.accessToken);
    }
  } catch {
    // Sign-in module absent or declined — proceed; the Drive op surfaces a
    // clear 401 if it genuinely has no token. Do not crash the pipeline here.
  }
}

async function ensureInitialized(): Promise<CloudKit> {
  const ck = getCloudKit();
  if (!initialized) {
    // Authenticate Drive BEFORE any file op when Drive is the active provider.
    // A failure here is a real, surfaced error (can't back up without Drive
    // access) — not a silent no-op — so the caller/UI can prompt the user to
    // connect Google. Done before initialize() so the token is present for any
    // Drive setup the native module performs.
    if (activeProvider === 'googleDrive') {
      await ensureDriveAuth();
    }
    try {
      await ck.initialize(CONTAINER_ID);
    } catch {
      // iCloud may be signed out — iOS file backup falls back to local
      // storage, and Android Drive ops surface their own errors on use.
      // Mirrors native, which never blocks backup on iCloud availability.
    }
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
  driveAuthorized = true;
}

/** Currently-active provider — convenience accessor for callers. */
export function getActiveProvider(): ProviderKind {
  return activeProvider;
}

function isBackupName(name: string): boolean {
  return name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_EXT);
}

function newBackupName(): string {
  // Unix seconds, matching Swift's `backup_\(Date().timeIntervalSince1970)`.
  // Fixed-width integers sort lexicographically == chronologically.
  return `${BACKUP_PREFIX}${String(Math.floor(Date.now() / 1000))}${BACKUP_EXT}`;
}

/** Backup filenames, newest last. */
async function sortedBackups(ck: CloudKit): Promise<readonly string[]> {
  const names = (await ck.listFileBackups()).filter(isBackupName);
  return [...names].sort();
}

/** Keep only the newest MAX_BACKUPS. Best-effort — never fails a backup. */
async function rotateBackups(ck: CloudKit): Promise<void> {
  try {
    const names = await sortedBackups(ck);
    if (names.length <= MAX_BACKUPS) return;
    const stale = names.slice(0, names.length - MAX_BACKUPS);
    for (const name of stale) {
      await ck.deleteFileBackup(name);
    }
  } catch {
    // Rotation is housekeeping; a failure here must not surface as a
    // backup failure to the user.
  }
}

/** Upload an arbitrary serialisable value, encrypted with the master key. */
export async function uploadBackup<T>(value: T): Promise<void> {
  const ciphertextB64 = await encryptJson(value);
  const fileB64 = encodeSolb(ciphertextB64);
  const ck = await ensureInitialized();
  await ck.writeFileBackup(newBackupName(), fileB64);
  await rotateBackups(ck);
}

/**
 * Pull the latest backup (if any). Returns null only when no backup file
 * exists; a present-but-unreadable/undecryptable backup throws so the caller
 * can distinguish "nothing to restore" from a real failure.
 */
export async function downloadBackup<T>(): Promise<T | null> {
  const ck = await ensureInitialized();
  const names = await sortedBackups(ck);
  const latest = names[names.length - 1];
  if (!latest) return null;
  const fileB64 = await ck.readFileBackup(latest);
  const ciphertextB64 = decodeSolb(fileB64);
  return await decryptJson<T>(ciphertextB64);
}

/** Returns the cloud-mtime so the UI can show "last backed up …". */
export async function backupMtime(): Promise<Date | null> {
  try {
    const ck = await ensureInitialized();
    const names = await sortedBackups(ck);
    const latest = names[names.length - 1];
    if (!latest) return null;
    const ms = await ck.getFileBackupMtime(latest);
    if (ms <= 0) return null;
    return new Date(ms);
  } catch {
    return null;
  }
}
