/**
 * Vault metadata sync — mirrors solidarity/Services/Vault/
 * VaultCloudSyncService(+Sync).swift.
 *
 * What syncs:
 *   - The metadata manifest: `{ items: { [id]: { modifiedAt, checksum,
 *     isDeleted } }, lastSync }`. Encrypted with the device master key
 *     before upload — the cloud never sees plaintext metadata, only an
 *     opaque ciphertext blob.
 *   - (Per-item ciphertext blobs are NOT yet synced — Swift uploads to
 *     iCloud Drive ubiquity container; an equivalent Nitro CloudKit
 *     "asset" surface is not yet wired. We mirror the manifest plumbing
 *     first so the conflict-resolution behaviour ports clean.)
 *
 * Conflict resolution: last-write-wins on `modifiedAt` (Swift `merge`
 * case). Items that exist only on one side flow to the other; items with
 * the same id but different `modifiedAt` become a `VaultConflict` the
 * caller can resolve via `resolveConflict({ resolution })`.
 *
 * Cloud transport:
 *   - iOS    → @solidarity/nitro-cloudkit (CKContainer private DB)
 *   - Android → same Nitro module backing onto Drive REST
 *   The existing `apps/expo/src/backup/cloudProvider.ts` covers the
 *   *device backup* record; this module reuses the same Nitro driver but
 *   writes to a distinct record id so the two payloads don't overwrite.
 */
import { Platform } from 'react-native';
import { getCloudKit, type CloudKit } from '@solidarity/nitro-cloudkit';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';

import type { VaultItem } from './store';

const VAULT_RECORD_TYPE = 'AirmeishiVaultManifest';
const VAULT_RECORD_ID = 'solidarity.vault.manifest.v1';
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
  lastSync: string | null = null
): VaultManifest {
  const out: Record<string, VaultManifestEntry> = {};
  for (const item of items) {
    out[item.id] = {
      modifiedAt: item.updatedAt.toISOString(),
      checksum: item.checksumSha256,
      isDeleted: false,
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
      merged[id] =
        Date.parse(l.modifiedAt) >= Date.parse(c.modifiedAt) ? l : c;
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

/**
 * Push local manifest to cloud. Returns the computed change set so the
 * caller can drive the per-item upload of ciphertext blobs.
 */
export async function syncVaultMetadata(
  localItems: readonly VaultItem[]
): Promise<SyncResult> {
  const local = buildLocalManifest(localItems);
  const cloud = (await readRemoteManifest()) ?? EMPTY_MANIFEST;
  const changes = computeSyncChanges(local, cloud);
  const merged = mergeManifests(local, cloud);
  const ok = await writeRemoteManifest(merged);
  if (!ok) {
    return { kind: 'err', reason: 'remoteWrite' };
  }
  return { kind: 'ok', merged, changes };
}

/**
 * Pull the cloud manifest + merge it into a local manifest derived from
 * `localItems`. The caller persists `merged.items` as the new local
 * manifest source of truth, and pulls down item ciphertext for `toDownload`.
 */
export async function pullVaultMetadata(
  localItems: readonly VaultItem[]
): Promise<SyncResult> {
  const local = buildLocalManifest(localItems);
  const cloud = await readRemoteManifest();
  if (cloud === null) {
    return { kind: 'err', reason: 'remoteRead' };
  }
  const changes = computeSyncChanges(local, cloud);
  const merged = mergeManifests(local, cloud);
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
