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
 * `@solidarity/nitro-keystone` file API (iOS ubiquity container / Android
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
import { getCloudKit, type CloudKit } from '@solidarity/nitro-keystone';

import { encryptJsonWithKey } from '../storage/jsonCrypto';
import {
  newBackupName,
  parseBackupTimestampMs,
  selectNewestBackup,
  sortBackupsByTimestamp,
} from './backupPolicy';
import { decodeSolb, encodeSolb, type SolbKeyScheme } from './solbEnvelope';

export type ProviderKind = 'iCloud' | 'googleDrive';

export const DEFAULT_PROVIDER: ProviderKind =
  Platform.OS === 'ios' ? 'iCloud' : 'googleDrive';

const CONTAINER_ID = 'iCloud.kidneyweakx.airmeishi';
/** Mirror Swift BackupManager.maxBackupCount. */
const MAX_BACKUPS = 5;

let activeProvider: ProviderKind = DEFAULT_PROVIDER;
let initialized = false;
/** True once a Drive access token has been pushed to the native client. */
let driveAuthorized = false;

export type DriveAuthStatus = 'authorized' | 'needs-connection' | 'unavailable';
/** Last-known Drive auth result (Android). 'needs-connection' means the user
 *  must connect Google Drive before a Drive backup can succeed — surfaced so
 *  the UI can prompt instead of an opaque downstream 401. */
let lastDriveAuthStatus: DriveAuthStatus = 'authorized';

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
async function ensureDriveAuth(interactive: boolean): Promise<DriveAuthStatus> {
  if (driveAuthorized) return 'authorized';
  try {
    const { signInForDrive, refreshDriveAccessToken } = await import('./googleAuth');
    try {
      setGoogleAccessToken(await refreshDriveAccessToken());
      return 'authorized';
    } catch {
      // Not signed in yet (or token expired without a refresh). Interactive
      // sign-in is reserved for explicit user actions (backup/restore/picker)
      // — a background PROBE must never open Google Sign-In on a fresh
      // install (the app promises no-account setup).
      if (!interactive) return 'needs-connection';
      const session = await signInForDrive();
      setGoogleAccessToken(session.accessToken);
      return 'authorized';
    }
  } catch {
    // Sign-in module absent (unit tests) OR user declined / not connected.
    // Report 'needs-connection' so the caller can prompt instead of letting a
    // downstream 401 surface as an opaque failure. Never crash the pipeline.
    return 'needs-connection';
  }
}

async function ensureInitialized(interactiveAuth = true): Promise<CloudKit> {
  const ck = getCloudKit();
  if (!initialized) {
    // Authenticate Drive BEFORE any file op when Drive is the active provider.
    // A failure here is a real, surfaced error (can't back up without Drive
    // access) — not a silent no-op — so the caller/UI can prompt the user to
    // connect Google. Done before initialize() so the token is present for any
    // Drive setup the native module performs.
    let authStatus: DriveAuthStatus = 'authorized';
    if (activeProvider === 'googleDrive') {
      authStatus = await ensureDriveAuth(interactiveAuth);
      lastDriveAuthStatus = authStatus;
    }
    try {
      await ck.initialize(CONTAINER_ID);
    } catch {
      // iCloud may be signed out — iOS file backup falls back to local
      // storage, and Android Drive ops surface their own errors on use.
      // Mirrors native, which never blocks backup on iCloud availability.
    }
    // A silent probe that could not auth must not latch: the next explicit
    // (interactive-allowed) call re-runs Drive auth instead of inheriting a
    // dead 401 session.
    initialized = !(
      activeProvider === 'googleDrive' &&
      authStatus !== 'authorized' &&
      !interactiveAuth
    );
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

/**
 * Ensure the active provider is initialised (and Drive authed on Android),
 * returning the Drive auth status so a caller can prompt the user to connect
 * Google Drive BEFORE attempting a backup that would otherwise 401.
 */
export async function prepareProvider(): Promise<DriveAuthStatus> {
  await ensureInitialized();
  return lastDriveAuthStatus;
}

/**
 * Backup filenames, oldest first → newest last. Chronological by parsed
 * timestamp (NOT a lexical filename sort, which mis-ordered across digit-count
 * boundaries and Swift decimal vs expo integer timestamps). Non-backup /
 * unparseable names are dropped here.
 */
async function sortedBackups(ck: CloudKit): Promise<readonly string[]> {
  const names = (await ck.listFileBackups()).filter(
    (n) => parseBackupTimestampMs(n) !== null,
  );
  return sortBackupsByTimestamp(names);
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

/**
 * Upload an arbitrary serialisable value as a portable **SOLB v2** Backup
 * Archive, encrypted with the caller-supplied Portable Backup Key (the
 * Recovery-Phrase-derived key — see `docs/adr/0001`). The key is passed in by
 * `backupManager` (which owns the identity concern); `cloudProvider` never
 * resolves keys itself. NEW writes are ALWAYS v2 — a v1 device-key archive is
 * never written again, because it can't be restored on another device.
 */
export async function uploadBackup<T>(value: T, key: Uint8Array): Promise<void> {
  const ciphertextB64 = encryptJsonWithKey(key, value);
  const fileB64 = encodeSolb(ciphertextB64, 2);
  const ck = await ensureInitialized();
  await ck.writeFileBackup(newBackupName(Date.now()), fileB64);
  await rotateBackups(ck);
}

/** The latest archive's key scheme + still-encrypted ciphertext. */
export interface DownloadedArchive {
  readonly keyScheme: SolbKeyScheme;
  readonly ciphertextB64: string;
}

/** One row in the user-facing archive picker (plan G6: dated explicit choice). */
export interface BackupArchiveInfo {
  readonly name: string;
  /** Parsed from the filename — when the archive was created. */
  readonly timestampMs: number;
  /**
   * 2 = portable (recovery-phrase key), 1 = legacy (device key, original
   * device only), null = header unreadable (corrupt / unknown format).
   */
  readonly version: 1 | 2 | null;
}

/**
 * List every archive on the active provider, NEWEST FIRST, with its creation
 * date and format version so the UI can label rows (dated explicit choice —
 * never a silent fallback to an older file, plan G6). Reads each file's 5-byte
 * SOLB header to classify it; MAX_BACKUPS caps this at 5 small files. A file
 * whose header fails to decode is listed as `version: null` rather than
 * hidden, so the user can see it exists even though it can't be restored.
 */
export async function listBackupArchives(): Promise<readonly BackupArchiveInfo[]> {
  const ck = await ensureInitialized();
  const names = await sortedBackups(ck); // oldest → newest
  const out: BackupArchiveInfo[] = [];
  for (const name of [...names].reverse()) {
    const timestampMs = parseBackupTimestampMs(name);
    if (timestampMs === null) continue;
    let version: 1 | 2 | null = null;
    try {
      version = decodeSolb(await ck.readFileBackup(name)).version;
    } catch {
      version = null;
    }
    out.push({ name, timestampMs, version });
  }
  return out;
}

/**
 * Pull + decode (NOT decrypt) a SPECIFIC archive by filename — the picker's
 * restore path. Same contract as `downloadLatestArchive`; throws when the file
 * is missing or unframeable.
 */
export async function downloadArchive(name: string): Promise<DownloadedArchive> {
  const ck = await ensureInitialized();
  const decoded = decodeSolb(await ck.readFileBackup(name));
  return { keyScheme: decoded.keyScheme, ciphertextB64: decoded.ciphertextB64 };
}

/**
 * Pull + decode (NOT decrypt) the latest Backup Archive. Returns null only
 * when no backup file exists; a present-but-unframeable file throws (bad
 * magic / unknown version / legacy plaintext) so the caller can distinguish
 * "nothing to restore" from a corrupt/unsupported file. Decryption is the
 * caller's job (`backupManager`) because the KEY depends on `keyScheme`: v2 →
 * Portable Backup Key, v1 → Device Storage Key. This keeps the "version selects
 * exactly one key scheme, never trial-decrypt" rule (see `solbEnvelope.ts`).
 */
export async function downloadLatestArchive(): Promise<DownloadedArchive | null> {
  const ck = await ensureInitialized();
  const names = await sortedBackups(ck);
  const latest = selectNewestBackup(names);
  if (!latest) return null;
  const fileB64 = await ck.readFileBackup(latest);
  const decoded = decodeSolb(fileB64);
  return { keyScheme: decoded.keyScheme, ciphertextB64: decoded.ciphertextB64 };
}

/** Returns the cloud-mtime so the UI can show "last backed up …".
 * SILENT auth only: this backs status displays and the fresh-install probe
 * (SecureKeysStep) — neither may open an interactive Google Sign-In. */
export async function backupMtime(): Promise<Date | null> {
  try {
    const ck = await ensureInitialized(false);
    const names = await sortedBackups(ck);
    const latest = selectNewestBackup(names);
    if (!latest) return null;
    const ms = await ck.getFileBackupMtime(latest);
    if (ms <= 0) return null;
    return new Date(ms);
  } catch {
    return null;
  }
}
