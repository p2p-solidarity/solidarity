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

import {
  deleteContact as removeFromStorage,
  loadAllContacts,
  saveContact as persistContact,
} from '../storage/storageManager';
import type { Contact } from '@solidarity/shared';

interface ContactStoreState {
  readonly contacts: ReadonlyMap<string, Contact>;
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly upsert: (contact: Contact) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

export const useContactStore = create<ContactStoreState>((set, get) => ({
  contacts: new Map(),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const list = await loadAllContacts();
    const next = new Map<string, Contact>();
    for (const c of list) next.set(c.id, c);
    set({ contacts: next, hydrated: true });
  },

  upsert: async (contact) => {
    await persistContact(contact);
    set((s) => {
      const next = new Map(s.contacts);
      next.set(contact.id, contact);
      return { contacts: next };
    });
  },

  remove: async (id) => {
    removeFromStorage(id);
    set((s) => {
      const next = new Map(s.contacts);
      next.delete(id);
      return { contacts: next };
    });
  },
}));

/** Sync accessor — returns the cached list without triggering load. */
export const useContactList = (): readonly Contact[] =>
  useContactStore((s) => Array.from(s.contacts.values()));

/** Sync accessor for a single contact, indexed by id. */
export const useContact = (id: string | undefined): Contact | undefined =>
  useContactStore((s) => (id ? s.contacts.get(id) : undefined));
