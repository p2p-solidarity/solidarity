/**
 * Shoutout store — local Sakura inbox + outbox.
 * Mirrors the Swift Shoutout / Sakura messaging surface.
 *
 * Each Shoutout is a `payload` opened by `openInboxMessage` (or composed
 * locally before send). We keep the metadata + plaintext in MMKV (encrypted
 * via storageManager) so the gallery renders sync from the cache.
 */
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

export type ShoutoutDirection = 'incoming' | 'outgoing';

export interface Shoutout {
  readonly id: string;
  readonly direction: ShoutoutDirection;
  readonly counterpartName: string;
  readonly subject: string;
  readonly body: string;
  readonly createdAt: Date;
}

const KEY_PREFIX = 'shoutout:';

interface ShoutoutStoreState {
  readonly items: readonly Shoutout[];
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly add: (s: Shoutout) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

export const useShoutoutStore = create<ShoutoutStoreState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const out: Shoutout[] = [];
    for (const k of getMmkv().getAllKeys()) {
      if (!k.startsWith(KEY_PREFIX)) continue;
      const raw = getMmkv().getString(k);
      if (!raw) continue;
      out.push(await decryptJson<Shoutout>(raw));
    }
    out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    set({ items: out, hydrated: true });
  },

  add: async (s) => {
    getMmkv().set(`${KEY_PREFIX}${s.id}`, await encryptJson(s));
    set((state) => ({
      items: [s, ...state.items.filter((i) => i.id !== s.id)],
    }));
  },

  remove: async (id) => {
    getMmkv().delete(`${KEY_PREFIX}${id}`);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },
}));
