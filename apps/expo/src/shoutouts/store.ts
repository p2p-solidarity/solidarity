/**
 * Shoutout store — local Sakura inbox + outbox.
 * Mirrors the Swift Shoutout / Sakura messaging surface.
 *
 * Each Shoutout is a `payload` opened by `openInboxMessage` (or composed
 * locally before send). We keep the metadata + plaintext in MMKV (encrypted
 * via storageManager) so the gallery renders sync from the cache.
 */
import { useMemo } from 'react';
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';

import {
  aggregateByAuthor,
  aggregateByTopic,
  timeSeriesDaily,
  type AuthorCount,
  type TimeSeriesPoint,
  type TopicCount,
} from './chartData';

export type ShoutoutDirection = 'incoming' | 'outgoing';

/**
 * Max payload size for a shoutout body. Mirrors Swift CreateShoutoutView.swift
 * (`message.count > 200` + the .prefix(200) truncation on input). Swift
 * `String.count` is grapheme-cluster count; the TS form treats it as JS
 * string length (UTF-16 code units), which differs only on emoji. For ASCII
 * text both compute the same value.
 */
export const SHOUTOUT_MAX_PAYLOAD_BYTES = 200;

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
      const item = await decryptJson<Shoutout>(raw);
      // JSON round-trip strips the Date prototype; rebuild it so sort
      // + downstream `.getTime()` keep working. Same pattern as Swift
      // ShoutoutStore which keeps Date objects through Codable.
      out.push({ ...item, createdAt: new Date(item.createdAt) });
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
    getMmkv().remove(`${KEY_PREFIX}${id}`);
    set((state) => ({ items: state.items.filter((i) => i.id !== id) }));
  },
}));

export interface ShoutoutChartData {
  readonly topics: readonly TopicCount[];
  readonly authors: readonly AuthorCount[];
  readonly activity: readonly TimeSeriesPoint[];
  readonly hydrated: boolean;
  readonly totalCount: number;
}

/**
 * Memoised aggregations for the Stats section above the gallery.
 *
 * Selector pattern (mirrors `useDisplayClaims` after Agent 16's fix):
 *   - Subscribe to the RAW slice (`s.items`) — zustand returns the same
 *     reference until something mutates, so `Object.is` is stable.
 *   - Derive the chart shape inside a `useMemo` so React skips
 *     recomputation when `items` is reference-equal.
 * Returning a fresh object from the selector would trip
 * `useSyncExternalStore`'s infinite-loop guard.
 */
export function useShoutoutChartData(): ShoutoutChartData {
  const items = useShoutoutStore((s) => s.items);
  const hydrated = useShoutoutStore((s) => s.hydrated);
  return useMemo(
    () => ({
      topics: aggregateByTopic(items),
      authors: aggregateByAuthor(items),
      activity: timeSeriesDaily(items),
      hydrated,
      totalCount: items.length,
    }),
    [items, hydrated]
  );
}
