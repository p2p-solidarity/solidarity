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

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

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
  readonly items: readonly VaultItem[];
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
  readonly hydrate: () => Promise<void>;
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

export const useVaultStore = create<VaultStoreState>((set, get) => ({
  items: [],
  hydrated: false,
  distributedShards: [],
  pendingRecovery: [],
  lastSyncedAt: null,
  isLocked: true,
  lastSyncedManifest: null,

  hydrate: async () => {
    if (get().hydrated) return;
    const out: VaultItem[] = [];
    for (const k of listKeys()) {
      const v = await getEncrypted<VaultItem>(k);
      if (!v) continue;
      // Same JSON-round-trip Date fix as shoutoutStore — `.getTime()`
      // after decryptJson would throw otherwise.
      out.push({
        ...v,
        createdAt: new Date(v.createdAt),
        updatedAt: new Date(v.updatedAt),
      });
    }
    out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    set({ items: out, hydrated: true });

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

  upsert: async (item) => {
    await setEncrypted(`${PREFIX}${item.id}`, item);
    set((s) => {
      const next = s.items.filter((i) => i.id !== item.id);
      return { items: [item, ...next] };
    });
  },

  remove: async (id) => {
    getMmkv().remove(`${PREFIX}${id}`);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
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
