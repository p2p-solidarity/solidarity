/**
 * Vault metadata + ciphertext sync — mirrors solidarity/Services/Vault/
 * VaultCloudSyncService(+Sync).swift.
 *
 * Two-tier transport (matches Swift split exactly):
 *
 *   1. **Manifest** — a single record `solidarity.vault.manifest.v1`
 *      holding the encrypted `{ items: { [id]: { modifiedAt, checksum,
 *      isDeleted, remoteRef? } }, lastSync }` map. The cloud never sees
 *      plaintext metadata. Mirrors Swift `syncManifestURL` (a single
 *      manifest file written into the iCloud Drive ubiquity container).
 *
 *   2. **Per-item ciphertext** — one record per VaultItem
 *      (`solidarity.vault.cipher.<itemId>`) carrying the AES-GCM sealed
 *      blob from `vault/<id>.enc`. Mirrors Swift's per-item
 *      `<itemId>.encrypted` files copied into the ubiquity container.
 *      The Nitro CloudKit module bridges to Drive AppData on Android, so
 *      this single code path serves both platforms.
 *
 * Why a single Nitro CloudKit transport instead of separate iCloud
 * Drive + Drive REST paths? The Nitro module abstracts both (record
 * CRUD on iOS = CKContainer; on Android = Drive REST under
 * `Solidarity/AirmeishiVaultCipher/<itemId>`). The split is preserved
 * by record-id naming, not by transport.
 *
 * Conflict resolution: last-write-wins on `modifiedAt` (Swift `merge`
 * case). When both sides have differing ciphertext for the same item,
 * the side whose manifest entry has the freshest `modifiedAt` wins —
 * matching Swift `resolveConflict(.merge)` in
 * VaultCloudSyncService.swift:171.
 *
 * The existing `apps/expo/src/backup/cloudProvider.ts` covers the
 * *device backup* record; this module reuses the same Nitro driver but
 * writes to distinct record ids so the payloads don't overwrite.
 */
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

import { getCloudKit, type CloudKit } from '@solidarity/nitro-keystone';

import {
  base64Decode,
  base64Encode,
  bytesToHex,
  sha256Bytes,
} from '@solidarity/shared';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
  trackLocalDataOperation,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import type { VaultItem } from './store';

const VAULT_RECORD_TYPE = 'AirmeishiVaultManifest';
const VAULT_RECORD_ID = 'solidarity.vault.manifest.v1';
const VAULT_CIPHER_RECORD_TYPE = 'AirmeishiVaultCipher';
const VAULT_CIPHER_RECORD_PREFIX = 'solidarity.vault.cipher.';
const CONTAINER_ID = 'iCloud.kidneyweakx.airmeishi';

export type CloudProviderKind = 'iCloud' | 'googleDrive';

let activeProvider: CloudProviderKind =
  Platform.OS === 'ios' ? 'iCloud' : 'googleDrive';
let initialized = false;

async function ensureInitialized(): Promise<CloudKit> {
  const ck = getCloudKit();
  if (!initialized) {
    await ck.initialize(CONTAINER_ID);
    initialized = true;
  }
  return ck;
}

export function setVaultCloudProvider(kind: CloudProviderKind): void {
  activeProvider = kind;
  initialized = false;
}

export function getVaultCloudProvider(): CloudProviderKind {
  return activeProvider;
}

// ── Manifest model — mirrors Swift SyncManifest / SyncManifestEntry ──────

export interface VaultManifestEntry {
  readonly modifiedAt: string;
  readonly checksum: string;
  readonly isDeleted: boolean;
  /**
   * CloudKit record id (or Drive file id) pointing at the per-item
   * ciphertext blob in the cloud. Absent until the blob has been
   * uploaded — mirrors Swift's "the ubiquity file exists at
   * `<itemId>.encrypted`" state via an explicit reference.
   */
  readonly remoteRef?: string;
  /**
   * Epoch ms when this remoteRef was last written. Lets the conflict
   * resolver tell which side has a fresher ciphertext when the manifest
   * `modifiedAt` ties.
   */
  readonly remoteUploadedAt?: number;
}

export interface VaultManifest {
  readonly items: Readonly<Record<string, VaultManifestEntry>>;
  readonly lastSync: string | null;
}

export const EMPTY_MANIFEST: VaultManifest = { items: {}, lastSync: null };

// ── Conflict typing — mirrors Swift VaultConflict ────────────────────────

export interface VaultConflict {
  readonly itemId: string;
  readonly localModifiedAt: string;
  readonly cloudModifiedAt: string;
  readonly localChecksum: string;
  readonly cloudChecksum: string;
}

export type ConflictResolution = 'keepLocal' | 'keepCloud' | 'merge';

export interface SyncChanges {
  readonly toUpload: readonly string[];
  readonly toDownload: readonly string[];
  readonly toDelete: readonly string[];
  readonly conflicts: readonly VaultConflict[];
}

interface ManifestRecordPayload {
  readonly ciphertextB64: string;
}

interface CipherRecordPayload {
  /** Base64 of the encrypted blob bytes (already AES-GCM sealed on-device). */
  readonly cipherB64: string;
  /** SHA-256 of the sealed bytes — lets the puller verify integrity. */
  readonly sha256: string;
  /** Epoch ms when this record was written. */
  readonly uploadedAt: number;
}

export type SyncResult =
  | {
      readonly kind: 'ok';
      readonly merged: VaultManifest;
      readonly changes: SyncChanges;
    }
  | {
      readonly kind: 'err';
      readonly reason: 'cloudUnavailable' | 'remoteRead' | 'remoteWrite';
    };

/** Convert the current vault items into a manifest. */
export function buildLocalManifest(
  items: readonly VaultItem[],
  lastSync: string | null = null,
  remoteRefs: Readonly<Record<string, { ref: string; uploadedAt: number }>> = {}
): VaultManifest {
  const out: Record<string, VaultManifestEntry> = {};
  for (const item of items) {
    const ref = remoteRefs[item.id];
    out[item.id] = {
      modifiedAt: item.updatedAt.toISOString(),
      checksum: item.checksumSha256,
      isDeleted: false,
      ...(ref
        ? { remoteRef: ref.ref, remoteUploadedAt: ref.uploadedAt }
        : {}),
    };
  }
  return { items: out, lastSync };
}

/** Compute uploads / downloads / conflicts — mirrors Swift computeSyncChanges. */
export function computeSyncChanges(
  local: VaultManifest,
  cloud: VaultManifest
): SyncChanges {
  const toUpload: string[] = [];
  const toDownload: string[] = [];
  const toDelete: string[] = [];
  const conflicts: VaultConflict[] = [];

  const ids = new Set([...Object.keys(local.items), ...Object.keys(cloud.items)]);
  for (const id of ids) {
    const l = local.items[id];
    const c = cloud.items[id];
    if (l && !c) {
      if (!l.isDeleted) toUpload.push(id);
      continue;
    }
    if (!l && c) {
      if (!c.isDeleted) toDownload.push(id);
      continue;
    }
    if (l && c) {
      if (l.isDeleted && !c.isDeleted) {
        toDelete.push(id);
      } else if (!l.isDeleted && c.isDeleted) {
        toUpload.push(id);
      } else if (l.modifiedAt !== c.modifiedAt) {
        conflicts.push({
          itemId: id,
          localModifiedAt: l.modifiedAt,
          cloudModifiedAt: c.modifiedAt,
          localChecksum: l.checksum,
          cloudChecksum: c.checksum,
        });
      }
    }
  }

  return { toUpload, toDownload, toDelete, conflicts };
}

/**
 * Last-write-wins merge: per-item, take whichever side has the latest
 * `modifiedAt`. Mirrors Swift's `.merge` ConflictResolution.
 *
 * `remoteRef` follows the winning side. When the local side wins but
 * has no remoteRef (fresh upload pending), we still preserve the cloud
 * `remoteRef` so the manifest stays internally consistent — the next
 * uploader will overwrite it once the ciphertext is pushed.
 */
export function mergeManifests(
  local: VaultManifest,
  cloud: VaultManifest
): VaultManifest {
  const merged: Record<string, VaultManifestEntry> = {};
  const ids = new Set([...Object.keys(local.items), ...Object.keys(cloud.items)]);
  for (const id of ids) {
    const l = local.items[id];
    const c = cloud.items[id];
    if (l && !c) {
      merged[id] = l;
    } else if (!l && c) {
      merged[id] = c;
    } else if (l && c) {
      const lWins = Date.parse(l.modifiedAt) >= Date.parse(c.modifiedAt);
      const winner = lWins ? l : c;
      // Carry across the remoteRef from the other side if the winner
      // doesn't have one yet — keeps the cipher record reachable.
      const ref = winner.remoteRef
        ? { remoteRef: winner.remoteRef, remoteUploadedAt: winner.remoteUploadedAt }
        : lWins && c.remoteRef
          ? { remoteRef: c.remoteRef, remoteUploadedAt: c.remoteUploadedAt }
          : !lWins && l.remoteRef
            ? { remoteRef: l.remoteRef, remoteUploadedAt: l.remoteUploadedAt }
            : {};
      merged[id] = {
        modifiedAt: winner.modifiedAt,
        checksum: winner.checksum,
        isDeleted: winner.isDeleted,
        ...ref,
      };
    }
  }
  return {
    items: merged,
    lastSync: new Date().toISOString(),
  };
}

// ── Remote IO via the Nitro CloudKit module ──────────────────────────────

async function readRemoteManifest(): Promise<VaultManifest | null> {
  try {
    const ck = await ensureInitialized();
    const record = await ck.fetchRecord(VAULT_RECORD_ID);
    const payload = JSON.parse(record.fields) as ManifestRecordPayload;
    if (!payload.ciphertextB64) return null;
    return await decryptJson<VaultManifest>(payload.ciphertextB64);
  } catch {
    return null;
  }
}

async function writeRemoteManifest(manifest: VaultManifest): Promise<boolean> {
  try {
    const ck = await ensureInitialized();
    const ciphertextB64 = await encryptJson(manifest);
    const payload: ManifestRecordPayload = { ciphertextB64 };
    await ck.saveRecord({
      recordId: VAULT_RECORD_ID,
      recordType: VAULT_RECORD_TYPE,
      fields: JSON.stringify(payload),
      modifiedTime: Date.now(),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Per-item ciphertext IO ───────────────────────────────────────────────

function cipherRecordId(itemId: string): string {
  return `${VAULT_CIPHER_RECORD_PREFIX}${itemId}`;
}

/**
 * Upload the encrypted blob at `encryptedBlobPath` to the cloud under a
 * per-item record id. Mirrors Swift VaultCloudSyncService.uploadItem —
 * the file is copied verbatim (no re-encryption — the blob is already
 * AES-GCM sealed by storage.ts).
 *
 * Returns the remote reference (CloudKit record id on iOS, the same id
 * mapped to a Drive file on Android) so the caller can stash it in the
 * manifest.
 */
export async function uploadVaultItemCiphertext(
  itemId: string,
  encryptedBlobPath: string
): Promise<{ remoteRef: string; uploadedAt: number }> {
  const ck = await ensureInitialized();
  const cipherB64 = await FileSystem.readAsStringAsync(encryptedBlobPath, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const sealed = base64Decode(cipherB64);
  const sha256 = bytesToHex(sha256Bytes(sealed));
  const uploadedAt = Date.now();
  const payload: CipherRecordPayload = { cipherB64, sha256, uploadedAt };
  const recordId = cipherRecordId(itemId);
  await ck.saveRecord({
    recordId,
    recordType: VAULT_CIPHER_RECORD_TYPE,
    fields: JSON.stringify(payload),
    modifiedTime: uploadedAt,
  });
  return { remoteRef: recordId, uploadedAt };
}

/**
 * Pull the per-item ciphertext blob from the cloud, writing it back to
 * the local vault directory at `vault/<id>.enc`. Mirrors Swift
 * VaultCloudSyncService.downloadItem. Returns the local path so the
 * caller can pipe it through `readVaultBlob` for decryption.
 *
 * The sha256 inside the cipher payload is checked against the sealed
 * bytes — a mismatch throws so the caller can fall back / retry rather
 * than write a tampered blob to disk.
 */
export function downloadVaultItemCiphertext(
  itemId: string,
  _remoteRef: string
): Promise<string> {
  return trackLocalDataOperation(
    downloadVaultItemCiphertextAtEpoch(
      itemId,
      _remoteRef,
      captureLocalDataEpoch(),
    ),
  );
}

function localDataWipeError(): Error {
  return new Error('Vault ciphertext download was invalidated by a local data wipe');
}

async function downloadVaultItemCiphertextAtEpoch(
  itemId: string,
  _remoteRef: string,
  writeEpoch: LocalDataEpoch,
): Promise<string> {
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  const ck = await ensureInitialized();
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  // `_remoteRef` and `cipherRecordId(itemId)` are equivalent today; we
  // accept both so callers can pass the manifest value verbatim and we
  // can evolve the ref scheme later without breaking the API.
  const record = await ck.fetchRecord(cipherRecordId(itemId));
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  const payload = JSON.parse(record.fields) as CipherRecordPayload;
  const sealed = base64Decode(payload.cipherB64);
  const actualSha = bytesToHex(sha256Bytes(sealed));
  if (actualSha !== payload.sha256) {
    throw new Error(
      `vault: cipher integrity check failed for ${itemId}: expected ${payload.sha256}, got ${actualSha}`
    );
  }
  const vaultDir = `${FileSystem.documentDirectory ?? ''}vault/`;
  const dirInfo = await FileSystem.getInfoAsync(vaultDir);
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(vaultDir, { intermediates: true });
    if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  }
  const localPath = `${vaultDir}${itemId}.enc`;
  await FileSystem.writeAsStringAsync(localPath, base64Encode(sealed), {
    encoding: FileSystem.EncodingType.Base64,
  });
  if (!canCommitLocalData(writeEpoch)) throw localDataWipeError();
  return localPath;
}

/**
 * Delete the per-item ciphertext blob from the cloud. Mirrors Swift
 * VaultCloudSyncService+Sync.processDeletions for a single id.
 * Best-effort — a 404 from the cloud is silently ignored so tombstone
 * processing stays idempotent.
 */
export async function pruneRemoteCiphertext(itemId: string): Promise<void> {
  try {
    const ck = await ensureInitialized();
    await ck.deleteRecord(cipherRecordId(itemId));
  } catch {
    // Already gone, or never uploaded — Swift's `try?` parity.
  }
}

// ── Per-item upload status helper ─────────────────────────────────────────

export type CloudCiphertextStatus =
  | 'local-only'
  | 'remote-only'
  | 'in-sync'
  | 'conflict';

/**
 * Classify a single item's ciphertext sync state. Mirrors the implicit
 * Swift check that drives `pendingConflicts` in the +Sync extension:
 *
 *   - `local-only`  → blob exists on disk, manifest has no remoteRef
 *   - `remote-only` → manifest has remoteRef, no local blob
 *   - `in-sync`     → both sides present and checksums agree
 *   - `conflict`    → both sides present but checksums diverge
 */
export function classifyCipherStatus(
  itemId: string,
  manifest: VaultManifest,
  hasLocalBlob: boolean,
  localChecksum: string | null
): CloudCiphertextStatus {
  const entry = manifest.items[itemId];
  const hasRemote = !!entry?.remoteRef;
  if (hasLocalBlob && !hasRemote) return 'local-only';
  if (!hasLocalBlob && hasRemote) return 'remote-only';
  if (hasLocalBlob && hasRemote) {
    // `entry` is non-null whenever `hasRemote` is — it's the source we
    // pulled `remoteRef` from. The runtime path is uniform.
    if (localChecksum && entry.checksum !== localChecksum) {
      return 'conflict';
    }
    return 'in-sync';
  }
  // No local, no remote — treat as "in-sync" (nothing to do).
  return 'in-sync';
}

/**
 * Push local manifest to cloud and upload any per-item ciphertext that
 * doesn't yet have a remote reference. After per-item uploads, the
 * manifest is re-written with the new refs so a fresh device can pull
 * it and discover the cipher record ids on first sync.
 *
 * Mirrors the Swift uploadChanges → saveManifests sequence: the
 * manifest write happens last, so a crashed run can never advertise a
 * remoteRef that isn't actually in the cloud.
 */
export async function syncVaultMetadata(
  localItems: readonly VaultItem[]
): Promise<SyncResult> {
  // Snapshot the existing cloud manifest so we can preserve any
  // remoteRefs that previous syncs already attached.
  const cloud = (await readRemoteManifest()) ?? EMPTY_MANIFEST;
  const existingRefs: Record<string, { ref: string; uploadedAt: number }> = {};
  for (const [id, entry] of Object.entries(cloud.items)) {
    if (entry.remoteRef) {
      existingRefs[id] = {
        ref: entry.remoteRef,
        uploadedAt: entry.remoteUploadedAt ?? 0,
      };
    }
  }
  const local = buildLocalManifest(localItems, null, existingRefs);
  const changes = computeSyncChanges(local, cloud);
  let merged = mergeManifests(local, cloud);

  // Upload per-item ciphertext for any item that has a local blob but
  // no remoteRef in the merged manifest. Failures here don't abort the
  // sync — the manifest write below preserves whatever refs we did get.
  const newRefs: Record<string, { ref: string; uploadedAt: number }> = {};
  for (const item of localItems) {
    const entry = merged.items[item.id];
    if (!entry || entry.isDeleted || entry.remoteRef) continue;
    try {
      const res = await uploadVaultItemCiphertext(item.id, item.encryptedPath);
      newRefs[item.id] = { ref: res.remoteRef, uploadedAt: res.uploadedAt };
    } catch {
      // Skip — we'll retry on the next sync.
    }
  }

  // Prune cloud cipher records for ids the local side has tombstoned.
  for (const id of changes.toDelete) {
    await pruneRemoteCiphertext(id);
  }

  // Fold the new refs back into the manifest before writing.
  if (Object.keys(newRefs).length > 0) {
    const withRefs: Record<string, VaultManifestEntry> = {};
    for (const [id, entry] of Object.entries(merged.items)) {
      const ref = newRefs[id];
      withRefs[id] = ref
        ? { ...entry, remoteRef: ref.ref, remoteUploadedAt: ref.uploadedAt }
        : entry;
    }
    merged = { items: withRefs, lastSync: merged.lastSync };
  }

  const ok = await writeRemoteManifest(merged);
  if (!ok) {
    return { kind: 'err', reason: 'remoteWrite' };
  }
  return { kind: 'ok', merged, changes };
}

/**
 * Pull the cloud manifest + merge it into a local manifest derived from
 * `localItems`. The caller persists `merged.items` as the new local
 * manifest source of truth.
 *
 * Ciphertext download is intentionally lazy here — callers invoke
 * `downloadVaultItemCiphertext` per item via the store
 * (`prefetchVaultCiphertext`) when the item is opened. Pass
 * `prefetchAll: true` to mirror Swift's eager `downloadChanges` loop.
 */
export async function pullVaultMetadata(
  localItems: readonly VaultItem[],
  options: { readonly prefetchAll?: boolean } = {}
): Promise<SyncResult> {
  const local = buildLocalManifest(localItems);
  const cloud = await readRemoteManifest();
  if (cloud === null) {
    return { kind: 'err', reason: 'remoteRead' };
  }
  const changes = computeSyncChanges(local, cloud);
  const merged = mergeManifests(local, cloud);

  if (options.prefetchAll) {
    for (const id of changes.toDownload) {
      const entry = merged.items[id];
      if (entry?.remoteRef) {
        try {
          await downloadVaultItemCiphertext(id, entry.remoteRef);
        } catch {
          // Continue with the other items.
        }
      }
    }
  }

  return { kind: 'ok', merged, changes };
}

/** Resolve a single conflict — returns the entry to keep. */
export function resolveConflict(
  conflict: VaultConflict,
  resolution: ConflictResolution
): VaultManifestEntry {
  switch (resolution) {
    case 'keepLocal':
      return {
        modifiedAt: conflict.localModifiedAt,
        checksum: conflict.localChecksum,
        isDeleted: false,
      };
    case 'keepCloud':
      return {
        modifiedAt: conflict.cloudModifiedAt,
        checksum: conflict.cloudChecksum,
        isDeleted: false,
      };
    case 'merge':
      return Date.parse(conflict.localModifiedAt) >=
        Date.parse(conflict.cloudModifiedAt)
        ? {
            modifiedAt: conflict.localModifiedAt,
            checksum: conflict.localChecksum,
            isDeleted: false,
          }
        : {
            modifiedAt: conflict.cloudModifiedAt,
            checksum: conflict.cloudChecksum,
            isDeleted: false,
          };
  }
}
