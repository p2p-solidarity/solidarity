/**
 * Card manager — zustand store backing BusinessCardForm + Me tab.
 * Mirrors Swift CardManager.shared (CRUD + dedup + validation).
 */
import { create } from 'zustand';

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

interface CardStoreState {
  readonly cards: readonly BusinessCard[];
  readonly hydrated: boolean;
  readonly hydrate: () => Promise<void>;
  readonly upsert: (card: BusinessCard) => Promise<{ ok: true } | { ok: false; error: CardError }>;
  readonly remove: (id: string) => Promise<void>;
}

export const useCardStore = create<CardStoreState>((set, get) => ({
  cards: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const list = await loadAllBusinessCards();
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
      return { cards: [...next, validation.data] };
    });
    return { ok: true };
  },

  remove: async (id) => {
    removeFromStorage(id);
    set((s) => ({ cards: s.cards.filter((c) => c.id !== id) }));
  },
}));

/** Selector for "my own card" — the first card created (parity with Swift Me tab). */
export const useMyCard = (): BusinessCard | undefined =>
  useCardStore((s) => s.cards[0]);
