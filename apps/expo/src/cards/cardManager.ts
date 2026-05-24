/**
 * Card manager — zustand store backing BusinessCardForm + Me tab.
 * Mirrors Swift CardManager.shared (CRUD + dedup + validation).
 */
import { create } from 'zustand';

import { CacheService } from '@/storage';
import {
  deleteBusinessCard as removeFromStorage,
  loadAllBusinessCards,
  saveBusinessCard,
} from '@/storage/storageManager';
import {
  businessCardSchema,
  type BusinessCard,
  type CardError,
} from '@solidarity/shared';

const CACHE_KEY = 'cards:v1';

interface CardStoreState {
  readonly cards: readonly BusinessCard[];
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly upsert: (card: BusinessCard) => Promise<{ ok: true } | { ok: false; error: CardError }>;
  readonly remove: (id: string) => Promise<void>;
}

// Rule 10: seed from MMKV hot cache so the first render of Me / Share never
// awaits storageManager. `getSync` returns null until MMKV is initialised
// (root layout `initMmkv()` resolves before hydrate runs), at which point
// it returns the previous list and the screen paints instantly.
function seedCards(): readonly BusinessCard[] {
  return CacheService.getSync<readonly BusinessCard[]>(CACHE_KEY) ?? [];
}

export const useCardStore = create<CardStoreState>((set, get) => ({
  cards: seedCards(),
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const list = await loadAllBusinessCards();
    CacheService.set(CACHE_KEY, list);
    set({ cards: list, hydrated: true });
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
      const next = s.cards.filter((c) => c.id !== card.id);
      const merged = [...next, validation.data];
      CacheService.set(CACHE_KEY, merged);
      return { cards: merged };
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
      const next = s.cards.filter((c) => c.id !== id);
      CacheService.set(CACHE_KEY, next);
      return { cards: next };
    });
  },
}));

/** Selector for "my own card" — the first card created (parity with Swift Me tab). */
export const useMyCard = (): BusinessCard | undefined =>
  useCardStore((s) => s.cards[0]);
