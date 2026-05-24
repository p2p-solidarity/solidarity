/**
 * Contact repository — zustand store mirroring Swift ContactRepository.shared.
 *
 * Single source of truth for the contact graph on the JS side. Hydrates
 * from MMKV on first read, then keeps an in-memory mirror so:
 *   - useContacts() returns sync data on every render (no skeleton flash)
 *   - mutations write-through to MMKV then notify subscribers
 *
 * Combine.@Published equivalent: zustand subscribe. Components opt into
 * granular re-render via selector (see useContact(id)).
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { CacheService } from '../storage';
import {
  deleteContact as removeFromStorage,
  loadAllContacts,
  saveContact as persistContact,
} from '../storage/storageManager';
import type { Contact } from '@solidarity/shared';

const CACHE_KEY = 'contacts:v1';

// Materialise the snapshot we cache (MMKV serialisation), then rebuild a
// Map so consumers keep their indexed lookup without paying for it on disk.
function readSeed(): ReadonlyMap<string, Contact> {
  const raw = CacheService.getSync<readonly Contact[]>(CACHE_KEY) ?? [];
  const next = new Map<string, Contact>();
  for (const c of raw) {
    // Date fields are JSON-serialised as ISO strings; coerce back so the
    // store always exposes Date instances (parity with cold-load).
    next.set(c.id, {
      ...c,
      receivedAt: new Date(c.receivedAt),
      businessCard: {
        ...c.businessCard,
        createdAt: new Date(c.businessCard.createdAt),
        updatedAt: new Date(c.businessCard.updatedAt),
      },
    } as Contact);
  }
  return next;
}

function writeSnapshot(map: ReadonlyMap<string, Contact>): void {
  CacheService.set(CACHE_KEY, Array.from(map.values()));
}

interface ContactStoreState {
  readonly contacts: ReadonlyMap<string, Contact>;
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly upsert: (contact: Contact) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

export const useContactStore = create<ContactStoreState>((set, get) => ({
  // Hot seed mirrors the last persisted snapshot so People paints rows on
  // frame 1 (no flash of empty state on warm starts).
  contacts: readSeed(),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const list = await loadAllContacts();
    const next = new Map<string, Contact>();
    for (const c of list) next.set(c.id, c);
    writeSnapshot(next);
    set({ contacts: next, hydrated: true });
  },

  upsert: async (contact) => {
    await persistContact(contact);
    set((s) => {
      const next = new Map(s.contacts);
      next.set(contact.id, contact);
      writeSnapshot(next);
      return { contacts: next };
    });
  },

  remove: async (id) => {
    removeFromStorage(id);
    set((s) => {
      const next = new Map(s.contacts);
      next.delete(id);
      writeSnapshot(next);
      return { contacts: next };
    });
  },
}));

/**
 * Sync accessor — returns the cached list without triggering load.
 *
 * `useShallow` is required: `Array.from(...)` produces a new reference each
 * render, which trips Zustand v5's `useSyncExternalStore` snapshot caching
 * and triggers an infinite re-render loop. Shallow comparison stabilises the
 * snapshot when the underlying map hasn't changed.
 */
export const useContactList = (): readonly Contact[] =>
  useContactStore(useShallow((s) => Array.from(s.contacts.values())));

/** Sync accessor for a single contact, indexed by id. */
export const useContact = (id: string | undefined): Contact | undefined =>
  useContactStore((s) => (id ? s.contacts.get(id) : undefined));
