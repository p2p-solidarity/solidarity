/**
 * Vault store — encrypted file vault. Mirrors Swift SovereignVaultService.
 *
 * Files are stored encrypted in expo-file-system's documentDirectory. The
 * MMKV index keeps lightweight metadata (name, size, contentType, mtime)
 * so the UI lists files without hitting the filesystem on every render.
 *
 * Encryption: AES-256-GCM per file via @solidarity/shared/crypto/aesGcm
 * with a per-item key derived (HKDF) from the master key + item id. The
 * derived keys never persist — they're re-derived on read.
 *
 * Recovery-rail extensions (mirroring SovereignVaultService + the cluster
 * around it):
 *   - `distributedShards` — local mirror of shards we've shipped out via
 *     sakura (one per guardian contact).
 *   - `pendingRecovery`   — snapshot of any in-flight recovery: how many
 *     shards we've received vs. the threshold.
 *   - `lastSyncedAt`      — last cloud manifest write, for the UI hint.
 *   - `isLocked`          — when true, sensitive actions re-prompt
 *     biometrics on next call (mirrors Swift VaultSecretsKeychain lock
 *     behaviour after evicting the cached secret).
 */
import { create } from 'zustand';

import { ManifestStorage } from '@/storage';
import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

import {
  VAULT_MANIFEST_SCOPE,
  toVaultManifest,
  type VaultManifestEntry,
} from './vaultManifest';

// All recovery-rail modules are imported as TYPES at the top of the file so
// that consumers who only need `VaultItem` don't drag react-native (via
// cloudSync.ts / inactivityMonitor.ts) into the module graph at load time.
// The runtime functions are resolved via dynamic `await import(...)` inside
// the actions that need them. This preserves the existing
// vaultEncryption.test.ts which imports `VaultItem` without RN mocks.
import type {
  CloudCiphertextStatus,
  SyncResult,
  VaultManifest,
} from './cloudSync';
import type {
  DistributionArgs,
  DistributionRecord,
  DistributionResult,
} from './shardDistribution';
import type {
  AddShardResult,
  RecoverySnapshot,
} from './recovery';
import type { WrappedShardEnvelope } from './shardEnvelope';

export type VaultItemKind = 'file' | 'json' | 'text' | 'image' | 'video' | 'document';

export interface VaultItem {
  readonly id: string;
  readonly name: string;
  readonly kind: VaultItemKind;
  readonly mimeType?: string;
  readonly size: number;
  readonly checksumSha256: string;
  readonly encryptedPath: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly tags: readonly string[];
}

const PREFIX = 'vault:';

async function setEncrypted<T>(key: string, value: T): Promise<void> {
  getMmkv().set(key, await encryptJson(value));
}
async function getEncrypted<T>(key: string): Promise<T | null> {
  const raw = getMmkv().getString(key);
  return raw ? await decryptJson<T>(raw) : null;
}
function listKeys(): readonly string[] {
  return getMmkv()
    .getAllKeys()
    .filter((k) => k.startsWith(PREFIX));
}

interface VaultStoreState {
  /**
   * Plaintext (MMKV-encrypted, not per-blob AES) manifest entries —
   * id/kind/size/updatedAt only. Seeded synchronously from MMKV via
   * `seedFromManifest()` so the list paints on frame 1 without
   * decrypting every vault blob. Filename stays encrypted-only; see
   * `vaultManifest.ts` for the privacy rationale.
   */
  readonly manifest: readonly VaultManifestEntry[];
  /**
   * Full `VaultItem` records, populated lazily by `loadDetail(id)` or
   * in one shot by `hydrate()`. Detail screens read from this map.
   */
  readonly details: ReadonlyMap<string, VaultItem>;
  /** Sorted list of fully-hydrated items. Empty until `hydrate()` runs. */
  readonly items: readonly VaultItem[];
  /** True once `hydrate()` has completed at least once. */
  readonly hydrated: boolean;
  readonly distributedShards: readonly DistributionRecord[];
  readonly pendingRecovery: readonly RecoverySnapshot[];
  readonly lastSyncedAt: string | null;
  readonly isLocked: boolean;
  /**
   * The last successfully merged manifest from cloudSync. Drives the
   * `cloudCiphertextStatus` selector so the UI can mark an item as
   * remote-only vs in-sync without re-reading the cloud.
   */
  readonly lastSyncedManifest: VaultManifest | null;
  /** Re-read the manifest from MMKV. Call once after `initMmkv()` resolves. */
  readonly seedFromManifest: () => void;
  /** Background bulk-decrypt of every vault item. Idempotent. */
  readonly hydrate: () => Promise<void>;
  /** Lazy single-record decrypt for detail screens. */
  readonly loadDetail: (id: string) => Promise<VaultItem | null>;
  readonly upsert: (item: VaultItem) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  readonly distributeShards: (args: DistributionArgs) => Promise<DistributionResult>;
  readonly addRecoveredShard: (
    envelope: WrappedShardEnvelope,
    wrapKey: Uint8Array
  ) => Promise<AddShardResult>;
  readonly unlockWithBiometric: () => Promise<boolean>;
  readonly lock: () => void;
  readonly syncCloud: () => Promise<SyncResult>;
  readonly pullCloud: (options?: { prefetchAll?: boolean }) => Promise<SyncResult>;
  /**
   * Pull the cipher blob for a single item from the cloud and write it
   * to the local vault directory. Returns the local path the item's
   * `encryptedPath` should point at after the download — callers update
   * the item via `upsert` if the path changed.
   */
  readonly prefetchVaultCiphertext: (itemId: string) => Promise<string | null>;
  /** Cross-platform mirror of Swift's per-item sync state. */
  readonly cloudCiphertextStatus: (itemId: string) => CloudCiphertextStatus;
}

function rehydrateDates(v: VaultItem): VaultItem {
  // Same JSON-round-trip Date fix as shoutoutStore — `.getTime()`
  // after decryptJson would throw otherwise.
  return {
    ...v,
    createdAt: new Date(v.createdAt),
    updatedAt: new Date(v.updatedAt),
  };
}

export const useVaultStore = create<VaultStoreState>((set, get) => ({
  manifest: [],
  details: new Map(),
  items: [],
  hydrated: false,
  distributedShards: [],
  pendingRecovery: [],
  lastSyncedAt: null,
  isLocked: true,
  lastSyncedManifest: null,

  seedFromManifest: () => {
    const seed = ManifestStorage.get<VaultManifestEntry>(VAULT_MANIFEST_SCOPE);
    if (seed) set({ manifest: seed });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const out: VaultItem[] = [];
    for (const k of listKeys()) {
      // Tolerant load — a corrupt MMKV value or stale schema for one
      // item must not blow up the whole vault. Skip and continue so
      // the rest of the vault still renders.
      try {
        const v = await getEncrypted<VaultItem>(k);
        if (!v) continue;
        out.push(rehydrateDates(v));
      } catch {
        continue;
      }
    }
    out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const details = new Map<string, VaultItem>();
    for (const it of out) details.set(it.id, it);
    const manifest = out.map(toVaultManifest);
    ManifestStorage.set(VAULT_MANIFEST_SCOPE, manifest);
    set({ items: out, details, manifest, hydrated: true });

    // Lazy-load the recovery rail so consumers that only need `VaultItem`
    // never pay the cost (or pull react-native via cloudSync.ts). Failure
    // is non-fatal — items are already in memory; the recovery snapshots
    // are reload-able on demand via `distributeShards` / `addRecoveredShard`.
    try {
      const [{ loadAllDistributionRecords }, { inspectRecovery }] = await Promise.all([
        import('./shardDistribution'),
        import('./recovery'),
      ]);
      const distributedShards = await loadAllDistributionRecords();
      const recoveryIds = new Set(distributedShards.map((r) => r.vaultId));
      const recoveries: RecoverySnapshot[] = [];
      for (const id of recoveryIds) {
        const snap = await inspectRecovery(id);
        if (snap) recoveries.push(snap);
      }
      set({ distributedShards, pendingRecovery: recoveries });
    } catch {
      // Recovery state stays empty; the user can still see / edit items.
    }
  },

  loadDetail: async (id) => {
    const cached = get().details.get(id);
    if (cached) return cached;
    try {
      const v = await getEncrypted<VaultItem>(`${PREFIX}${id}`);
      if (!v) return null;
      const item = rehydrateDates(v);
      set((s) => {
        const next = new Map(s.details);
        next.set(id, item);
        return { details: next };
      });
      return item;
    } catch {
      return null;
    }
  },

  upsert: async (item) => {
    await setEncrypted(`${PREFIX}${item.id}`, item);
    set((s) => {
      const nextItems = [item, ...s.items.filter((i) => i.id !== item.id)];
      const entry = toVaultManifest(item);
      const idx = s.manifest.findIndex((m) => m.id === entry.id);
      const nextManifest = idx >= 0
        ? s.manifest.map((m, i) => (i === idx ? entry : m))
        : [entry, ...s.manifest];
      ManifestStorage.set(VAULT_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.set(item.id, item);
      return { items: nextItems, manifest: nextManifest, details: nextDetails };
    });
  },

  remove: async (id) => {
    getMmkv().remove(`${PREFIX}${id}`);
    set((s) => {
      const nextManifest = s.manifest.filter((m) => m.id !== id);
      ManifestStorage.set(VAULT_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.delete(id);
      return {
        items: s.items.filter((i) => i.id !== id),
        manifest: nextManifest,
        details: nextDetails,
      };
    });
  },

  distributeShards: async (args) => {
    const dist = await import('./shardDistribution');
    const result = await dist.distributeRecoveryShards(args);
    if (result.kind === 'ok') {
      const all = await dist.loadAllDistributionRecords();
      set({ distributedShards: all });
    }
    return result;
  },

  addRecoveredShard: async (envelope, wrapKey) => {
    const rec = await import('./recovery');
    const res = await rec.addReceivedShard(envelope, wrapKey);
    const snap = await rec.inspectRecovery(envelope.vaultId);
    if (snap) {
      set((s) => {
        const others = s.pendingRecovery.filter(
          (p) => p.vaultId !== envelope.vaultId
        );
        return { pendingRecovery: [...others, snap] };
      });
    }
    return res;
  },

  unlockWithBiometric: async () => {
    const { getOrCreateRootSecret } = await import('./secretsKeychain');
    const r = await getOrCreateRootSecret('biometric');
    const unlocked = r.kind === 'ok';
    set({ isLocked: !unlocked });
    return unlocked;
  },

  lock: () => {
    void import('./secretsKeychain').then(({ evictCachedRootSecret }) => {
      evictCachedRootSecret();
    });
    set({ isLocked: true });
  },

  syncCloud: async () => {
    const { syncVaultMetadata } = await import('./cloudSync');
    const res = await syncVaultMetadata(get().items);
    if (res.kind === 'ok') {
      set({
        lastSyncedAt: res.merged.lastSync,
        lastSyncedManifest: res.merged,
      });
    }
    return res;
  },

  pullCloud: async (options) => {
    const { pullVaultMetadata } = await import('./cloudSync');
    const res = await pullVaultMetadata(get().items, options ?? {});
    if (res.kind === 'ok') {
      set({
        lastSyncedAt: res.merged.lastSync,
        lastSyncedManifest: res.merged,
      });
    }
    return res;
  },

  prefetchVaultCiphertext: async (itemId) => {
    const manifest = get().lastSyncedManifest;
    const entry = manifest?.items[itemId];
    if (!entry?.remoteRef) return null;
    const { downloadVaultItemCiphertext } = await import('./cloudSync');
    try {
      const localPath = await downloadVaultItemCiphertext(itemId, entry.remoteRef);
      // If we know about this item locally and its encryptedPath drifted
      // (fresh-device case), update the metadata so subsequent reads hit
      // the new file. Otherwise leave the store alone — the metadata
      // restore is a separate manifest pull responsibility.
      const existing = get().items.find((i) => i.id === itemId);
      if (existing && existing.encryptedPath !== localPath) {
        await get().upsert({ ...existing, encryptedPath: localPath });
      }
      return localPath;
    } catch {
      return null;
    }
  },

  cloudCiphertextStatus: (itemId) => {
    // Inline classifier mirrors cloudSync.classifyCipherStatus exactly —
    // duplicated here so this synchronous selector doesn't pull cloudSync
    // (and its `react-native` import chain) into the module graph for
    // consumers that never need the cloud rail.
    const manifest = get().lastSyncedManifest ?? { items: {}, lastSync: null };
    const local = get().items.find((i) => i.id === itemId);
    const hasLocal = !!local?.encryptedPath;
    const entry = manifest.items[itemId];
    const hasRemote = !!entry?.remoteRef;
    if (hasLocal && !hasRemote) return 'local-only';
    if (!hasLocal && hasRemote) return 'remote-only';
    if (hasLocal && hasRemote) {
      // Both `entry` and `local` are non-null whenever their hasX flags
      // are — see the construction above. The narrower needs the cast.
      if (entry.checksum !== local.checksumSha256) {
        return 'conflict';
      }
      return 'in-sync';
    }
    return 'in-sync';
  },
}));

export type { VaultManifestEntry } from './vaultManifest';
export { VAULT_MANIFEST_SCOPE, toVaultManifest } from './vaultManifest';
