/**
 * Contact repository — zustand store mirroring Swift ContactRepository.shared.
 *
 * Single source of truth for the contact graph on the JS side.
 *
 * Boot model (Path A — manifest + lazy details, parity with `cardManager`):
 *
 *   Frame 1   `manifest`  populated synchronously from MMKV via
 *             `seedFromManifest()` (called by root layout after
 *             `initMmkv()` resolves). Holds non-PII display fields only —
 *             name, title, company, source, tags, receivedAt (ISO),
 *             verificationStatus.
 *
 *   After     `details`   ReadonlyMap<id, Contact> populated lazily.
 *             `loadDetail(id)` decrypts one record; `hydrate()` bulk-
 *             decrypts every contact in the background. Screens that
 *             need email / phone / profile image / notes / sealed-route
 *             keys read from `details.get(id)`.
 *
 *   Writes    `upsert(contact)` persists the encrypted record + updates
 *             the manifest + warms the detail map in one atomic state
 *             update. `remove(id)` mirrors that across all three.
 *
 * `hydrate()` is idempotent so screens that mount before the background
 * bulk hydrate finishes can safely trigger it again — only the first call
 * actually does work.
 *
 * Date-coercion note: encrypted records persist Dates as ISO strings;
 * `loadAllContacts` / `loadContact` re-parse them via `contactSchema`
 * (zod `z.coerce.date()`) so consumers always see Date instances. The
 * manifest stores `receivedAt` as a string — read sites that need a Date
 * call `new Date(entry.receivedAt)`.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';

import { ManifestStorage } from '@/storage';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';
import {
  deleteContact as removeFromStorage,
  loadAllContacts,
  loadContact,
  saveContact as persistContact,
} from '@/storage/storageManager';
import type { Contact } from '@solidarity/shared';

import {
  CONTACTS_MANIFEST_SCOPE,
  toContactManifest,
  type ContactManifestEntry,
} from './contactManifest';

let localWipeGeneration = 0;
let contactMutationGeneration = 0;
let contactHydrationPromise: Promise<void> | null = null;

interface ContactStoreState {
  readonly manifest: readonly ContactManifestEntry[];
  readonly details: ReadonlyMap<string, Contact>;
  readonly detailsHydrated: boolean;
  /** Re-read the manifest from MMKV. Call once after `initMmkv()` resolves. */
  readonly seedFromManifest: () => void;
  /** Background bulk-decrypt of every contact. Idempotent. */
  readonly hydrate: () => Promise<void>;
  /** Lazy single-record decrypt for detail screens. */
  readonly loadDetail: (id: string) => Promise<Contact | null>;
  readonly upsert: (contact: Contact) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
  /** Drop every live reference after the encrypted local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

export const useContactStore = create<ContactStoreState>((set, get) => ({
  manifest: [],
  details: new Map(),
  detailsHydrated: false,

  seedFromManifest: () => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    const seed = ManifestStorage.get<ContactManifestEntry>(CONTACTS_MANIFEST_SCOPE);
    if (seed) set({ manifest: seed });
  },

  hydrate: () => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch) || get().detailsHydrated) {
      return Promise.resolve();
    }
    if (contactHydrationPromise) return contactHydrationPromise;

    const hydrateLatest = async (): Promise<void> => {
      // A delete/upsert can land while an encrypted row is being decrypted.
      // In that case the loaded array is stale, so read the current storage
      // snapshot again instead of resurrecting the deleted/old record in the
      // manifest. Concurrent callers share this one retrying promise.
      while (generation === localWipeGeneration && canCommitLocalData(writeEpoch)) {
        const mutationGeneration = contactMutationGeneration;
        // `loadAllContacts` is tolerant — corrupt rows are skipped by the
        // underlying `loadAllEncrypted` helper, so a single bad blob can't
        // wedge the whole list.
        const list = await loadAllContacts();
        if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
        if (mutationGeneration !== contactMutationGeneration) continue;

        const details = new Map<string, Contact>();
        for (const c of list) details.set(c.id, c);
        const manifest = list.map(toContactManifest);
        ManifestStorage.set(CONTACTS_MANIFEST_SCOPE, manifest);
        set({ manifest, details, detailsHydrated: true });
        return;
      }
    };

    const pending = hydrateLatest();
    contactHydrationPromise = pending;
    void pending.then(
      () => {
        if (contactHydrationPromise === pending) contactHydrationPromise = null;
      },
      () => {
        if (contactHydrationPromise === pending) contactHydrationPromise = null;
      },
    );
    return pending;
  },

  loadDetail: async (id) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return null;
    const mutationGeneration = contactMutationGeneration;
    const cached = get().details.get(id);
    if (cached) return cached;
    const contact = await loadContact(id);
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return null;
    if (mutationGeneration !== contactMutationGeneration) {
      return get().details.get(id) ?? null;
    }
    if (!contact) return null;
    set((s) => {
      const next = new Map(s.details);
      next.set(id, contact);
      return { details: next };
    });
    return contact;
  },

  upsert: async (contact) => {
    const generation = localWipeGeneration;
    const writeEpoch = captureLocalDataEpoch();
    if (!canCommitLocalData(writeEpoch)) return;
    contactMutationGeneration += 1;
    await persistContact(contact);
    if (generation !== localWipeGeneration || !canCommitLocalData(writeEpoch)) return;
    set((s) => {
      const entry = toContactManifest(contact);
      const idx = s.manifest.findIndex((m) => m.id === entry.id);
      const nextManifest = idx >= 0
        ? s.manifest.map((m, i) => (i === idx ? entry : m))
        : [...s.manifest, entry];
      ManifestStorage.set(CONTACTS_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.set(contact.id, contact);
      return { manifest: nextManifest, details: nextDetails };
    });
  },

  remove: (id) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return Promise.resolve();
    contactMutationGeneration += 1;
    removeFromStorage(id);
    set((s) => {
      const nextManifest = s.manifest.filter((m) => m.id !== id);
      ManifestStorage.set(CONTACTS_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.delete(id);
      return { manifest: nextManifest, details: nextDetails };
    });
    return Promise.resolve();
  },

  resetForLocalWipe: () => {
    localWipeGeneration += 1;
    set({ manifest: [], details: new Map(), detailsHydrated: true });
  },
}));

/**
 * Manifest list — non-PII entries safe to render on frame 1.
 *
 * `useShallow` is required: `s.manifest` is a stable array reference, but
 * downstream selectors that derive arrays (filter/sort) would still trigger
 * Zustand v5's `useSyncExternalStore` snapshot caching without it. Keeping
 * the shallow comparator here lets callers chain `useMemo` filters safely.
 */
export const useContactList = (): readonly ContactManifestEntry[] =>
  useContactStore(useShallow((s) => s.manifest));

/**
 * Full Contact list — only call from screens that need email / phone /
 * sealed-route / lastInteraction. Triggers `hydrate()` in the background
 * so cold starts can still paint manifest rows immediately while the full
 * decrypt resolves.
 *
 * `useShallow` is required: `Array.from(...)` produces a new reference each
 * render, which trips Zustand v5's snapshot caching and triggers an infinite
 * re-render loop. Shallow comparison stabilises the snapshot when the
 * underlying map hasn't changed.
 */
export const useContactListDetail = (): readonly Contact[] =>
  useContactStore(useShallow((s) => Array.from(s.details.values())));

/**
 * Sync accessor for a single Contact, indexed by id. Kicks off a lazy
 * `loadDetail(id)` in an effect when the requested id isn't in the
 * details map yet — frame 1 returns `undefined` and the component re-
 * renders with the full record once decryption resolves.
 *
 * Mirrors the cardManager pattern but inlines the effect so consumers
 * don't have to wire `useEffect` + `loadDetail` themselves at every
 * detail screen.
 */
export const useContact = (id: string | undefined): Contact | undefined => {
  const loadDetail = useContactStore((s) => s.loadDetail);
  const contact = useContactStore((s) => (id ? s.details.get(id) : undefined));
  useEffect(() => {
    if (id && !contact) void loadDetail(id);
  }, [id, contact, loadDetail]);
  return contact;
};

export type { ContactManifestEntry } from './contactManifest';
