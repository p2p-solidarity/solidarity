/**
 * Card manager — zustand store backing BusinessCardForm + Me/Share tabs.
 * Mirrors Swift CardManager.shared (CRUD + dedup + validation).
 *
 * Boot model (Path A — manifest + lazy details):
 *
 *   Frame 1   `manifest`  populated synchronously from MMKV via
 *             `seedFromManifest()` (called by root layout after
 *             `initMmkv()` resolves). Holds non-PII display fields only —
 *             name, title, company, animal.
 *
 *   After     `details`   ReadonlyMap<id, BusinessCard> populated lazily.
 *             `loadDetail(id)` decrypts one record (~1–3 ms); `hydrate()`
 *             bulk-decrypts all cards in the background. Screens that
 *             need email / phone / socials / sharing prefs read from
 *             `details.get(id)`.
 *
 *   Writes    `upsert(card)` persists the encrypted record + updates the
 *             manifest + warms the detail map in one atomic state update.
 *             `remove(id)` mirrors that across all three.
 *
 * The `hydrate()` call is idempotent so screens that mount before the
 * background bulk hydrate finishes can safely trigger it again — only
 * the first call actually does work.
 */
import { create } from 'zustand';

import { ManifestStorage } from '@/storage';
import {
  deleteBusinessCard as removeFromStorage,
  loadAllBusinessCards,
  loadBusinessCard,
  saveBusinessCard,
} from '@/storage/storageManager';
import {
  businessCardSchema,
  type BusinessCard,
  type CardError,
} from '@solidarity/shared';

import {
  CARDS_MANIFEST_SCOPE,
  toCardManifest,
  type CardManifestEntry,
} from './cardManifest';

interface CardStoreState {
  readonly manifest: readonly CardManifestEntry[];
  readonly details: ReadonlyMap<string, BusinessCard>;
  readonly detailsHydrated: boolean;
  /** Re-read the manifest from MMKV. Call once after `initMmkv()` resolves. */
  readonly seedFromManifest: () => void;
  /** Background bulk-decrypt of every card. Idempotent. */
  readonly hydrate: () => Promise<void>;
  /** Lazy single-record decrypt for detail screens. */
  readonly loadDetail: (id: string) => Promise<BusinessCard | null>;
  readonly upsert: (
    card: BusinessCard,
  ) => Promise<{ ok: true } | { ok: false; error: CardError }>;
  readonly remove: (id: string) => Promise<void>;
}

export const useCardStore = create<CardStoreState>((set, get) => ({
  manifest: [],
  details: new Map(),
  detailsHydrated: false,

  seedFromManifest: () => {
    const seed = ManifestStorage.get<CardManifestEntry>(CARDS_MANIFEST_SCOPE);
    if (seed) set({ manifest: seed });
  },

  hydrate: async () => {
    if (get().detailsHydrated) return;
    const list = await loadAllBusinessCards();
    const details = new Map<string, BusinessCard>();
    for (const c of list) details.set(c.id, c);
    const manifest = list.map(toCardManifest);
    ManifestStorage.set(CARDS_MANIFEST_SCOPE, manifest);
    set({ manifest, details, detailsHydrated: true });
  },

  loadDetail: async (id) => {
    const cached = get().details.get(id);
    if (cached) return cached;
    const card = await loadBusinessCard(id);
    if (!card) return null;
    set((s) => {
      const next = new Map(s.details);
      next.set(id, card);
      return { details: next };
    });
    return card;
  },

  upsert: async (card) => {
    const validation = businessCardSchema.safeParse(card);
    if (!validation.success) {
      return {
        ok: false,
        error: { type: 'validationError', message: validation.error.message },
      };
    }
    await saveBusinessCard(validation.data);
    set((s) => {
      const entry = toCardManifest(validation.data);
      const idx = s.manifest.findIndex((m) => m.id === entry.id);
      const nextManifest = idx >= 0
        ? s.manifest.map((m, i) => (i === idx ? entry : m))
        : [...s.manifest, entry];
      ManifestStorage.set(CARDS_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.set(validation.data.id, validation.data);
      return { manifest: nextManifest, details: nextDetails };
    });
    return { ok: true };
  },

  remove: async (id) => {
    // TODO(biometric-gate): gate this deletion with
    //   const gate = await requireSensitiveAction(
    //     'deleteZKIdentity',
    //     'Authorize deleting your business card'
    //   );
    //   if (!gate.success) return { ok: false, error: 'biometricDenied' };
    removeFromStorage(id);
    set((s) => {
      const nextManifest = s.manifest.filter((m) => m.id !== id);
      ManifestStorage.set(CARDS_MANIFEST_SCOPE, nextManifest);
      const nextDetails = new Map(s.details);
      nextDetails.delete(id);
      return { manifest: nextManifest, details: nextDetails };
    });
  },
}));

/** Selector for "my own card" — the first manifest entry. Frame-1 safe. */
export const useMyCard = (): CardManifestEntry | undefined =>
  useCardStore((s) => s.manifest[0]);

/**
 * Full record for "my own card". Returns `undefined` until `hydrate()`
 * has run or the consumer calls `loadDetail()`. Use this when you need
 * email / phone / socials / sharing prefs.
 */
export const useMyCardDetail = (): BusinessCard | undefined =>
  useCardStore((s) => {
    const first = s.manifest[0];
    return first ? s.details.get(first.id) : undefined;
  });

export type { CardManifestEntry } from './cardManifest';
