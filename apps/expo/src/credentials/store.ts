/**
 * Credentials store — mirrors Swift VCLibrary + IdentityCardEntity.
 *
 * Holds raw VC JWTs + decoded headline fields (issuer, trust level, expiry)
 * so the Me tab list renders sync without re-parsing on every render.
 */
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

export type TrustLevel = 'L1' | 'L2' | 'L3';

export interface StoredCredential {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly trustLevel: TrustLevel;
  readonly rawJwt: string;
  readonly issuedAt: Date;
  readonly expiresAt?: Date;
  readonly metadataTags: readonly string[];
}

const PREFIX = 'vc:';

async function setEncrypted<T>(key: string, value: T): Promise<void> {
  getMmkv().set(key, await encryptJson(value));
}
async function getEncrypted<T>(key: string): Promise<T | null> {
  const raw = getMmkv().getString(key);
  return raw ? await decryptJson<T>(raw) : null;
}

interface CredentialStoreState {
  readonly items: readonly StoredCredential[];
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly add: (v: StoredCredential) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

export const useCredentialStore = create<CredentialStoreState>((set, get) => ({
  items: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const out: StoredCredential[] = [];
    for (const k of getMmkv().getAllKeys()) {
      if (!k.startsWith(PREFIX)) continue;
      const v = await getEncrypted<StoredCredential>(k);
      if (v) out.push(v);
    }
    out.sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime());
    set({ items: out, hydrated: true });
  },

  add: async (v) => {
    await setEncrypted(`${PREFIX}${v.id}`, v);
    set((s) => ({
      items: [v, ...s.items.filter((i) => i.id !== v.id)],
    }));
  },

  remove: async (id) => {
    getMmkv().remove(`${PREFIX}${id}`);
    set((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
}));
