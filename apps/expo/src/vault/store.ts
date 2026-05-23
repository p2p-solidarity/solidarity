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
 */
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

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
  readonly hydrate: () => Promise<void>;
  readonly upsert: (item: VaultItem) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

export const useVaultStore = create<VaultStoreState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const out: VaultItem[] = [];
    for (const k of listKeys()) {
      const v = await getEncrypted<VaultItem>(k);
      if (v) out.push(v);
    }
    out.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    set({ items: out, hydrated: true });
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
}));
