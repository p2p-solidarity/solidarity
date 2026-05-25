/**
 * Shoutout store — local Sakura inbox + outbox.
 * Mirrors the Swift Shoutout / Sakura messaging surface.
 *
 * Each Shoutout is a `payload` opened by `openInboxMessage` (or composed
 * locally before send). The encrypted body lives in MMKV under
 * `shoutout:{id}`; a tiny `ShoutoutManifestEntry` per record lives in the
 * shared manifest sidecar so cold launch can paint the gallery / detail
 * header without N `decryptJson` calls.
 *
 * Boot model (Path A — manifest + lazy details):
 *
 *   Frame 1   `manifest`  populated synchronously from MMKV via
 *             `seedFromManifest()`. Holds non-sensitive fields only —
 *             id, direction, counterpartName, lastInteractionAt (ISO).
 *
 *   After     `details`   ReadonlyMap<id, Shoutout> populated lazily.
 *             `loadDetail(id)` decrypts one record (~1–3 ms); `hydrate()`
 *             bulk-decrypts every shoutout in the background. Screens
 *             that need `subject` / `body` (chart aggregateByTopic,
 *             MessageBullet in the detail history list) read from
 *             `details.get(id)`.
 *
 *   Writes    `add(s)` persists the encrypted record + updates the
 *             manifest + warms the detail map in one atomic state
 *             update. `remove(id)` mirrors that across all three.
 *
 * Back-compat: `items` is a derived array of fully-decrypted Shoutout
 * records (sorted newest-first) so the existing consumers in
 * `chartService.ts`, `chartData.ts`, and the per-counterpart filter on
 * `app/shoutouts/[id].tsx` keep working. Until `hydrate()` resolves,
 * `items` is empty even when `manifest` is populated — chart / message
 * history therefore continue to require the existing `void
 * hydrateShoutouts()` calls on screen mount.
 */
import { useMemo } from 'react';
import { create } from 'zustand';

import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';
import { ManifestStorage } from '@/storage/manifestStorage';

import {
  aggregateByAuthor,
  aggregateByTopic,
  timeSeriesDaily,
  type AuthorCount,
  type TimeSeriesPoint,
  type TopicCount,
} from './chartData';
import {
  SHOUTOUTS_MANIFEST_SCOPE,
  toShoutoutManifest,
  type ShoutoutManifestEntry,
} from './shoutoutManifest';

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
  /** Frame-1-safe non-sensitive list, newest-first. */
  readonly manifest: readonly ShoutoutManifestEntry[];
  /** Lazily-decrypted full records, keyed by id. */
  readonly details: ReadonlyMap<string, Shoutout>;
  readonly detailsHydrated: boolean;
  /**
   * Back-compat: fully-decrypted records sorted newest-first. Derived
   * from `details` on each write so existing consumers (chart
   * aggregations, per-counterpart filter) keep working unchanged.
   */
  readonly items: readonly Shoutout[];
  readonly hydrated: boolean;
  /** Re-read the manifest from MMKV. Call once after `initMmkv()` resolves. */
  readonly seedFromManifest: () => void;
  /** Background bulk-decrypt of every shoutout. Idempotent. */
  readonly hydrate: () => Promise<void>;
  /** Lazy single-record decrypt for detail screens. */
  readonly loadDetail: (id: string) => Promise<Shoutout | null>;
  readonly add: (s: Shoutout) => Promise<void>;
  readonly remove: (id: string) => Promise<void>;
}

function sortNewestFirst(records: readonly Shoutout[]): readonly Shoutout[] {
  return [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function detailsToItems(details: ReadonlyMap<string, Shoutout>): readonly Shoutout[] {
  return sortNewestFirst(Array.from(details.values()));
}

export const useShoutoutStore = create<ShoutoutStoreState>((set, get) => ({
  manifest: [],
  details: new Map(),
  detailsHydrated: false,
  items: [],
  hydrated: false,

  seedFromManifest: () => {
    const seed = ManifestStorage.get<ShoutoutManifestEntry>(SHOUTOUTS_MANIFEST_SCOPE);
    if (seed) set({ manifest: seed });
  },

  hydrate: async () => {
    if (get().detailsHydrated) return;
    const details = new Map<string, Shoutout>();
    for (const k of getMmkv().getAllKeys()) {
      if (!k.startsWith(KEY_PREFIX)) continue;
      const raw = getMmkv().getString(k);
      if (!raw) continue;
      try {
        const item = await decryptJson<Shoutout>(raw);
        // JSON round-trip strips the Date prototype; rebuild it so sort
        // + downstream `.getTime()` keep working. Same pattern as Swift
        // ShoutoutStore which keeps Date objects through Codable.
        const revived: Shoutout = { ...item, createdAt: new Date(item.createdAt) };
        details.set(revived.id, revived);
      } catch {
        // Corrupt / wrong-key blob — skip so one bad record doesn't
        // block boot. The original encrypted key stays in MMKV so a
        // future migration can attempt to recover it.
        continue;
      }
    }
    const items = detailsToItems(details);
    const manifest = items.map(toShoutoutManifest);
    ManifestStorage.set(SHOUTOUTS_MANIFEST_SCOPE, manifest);
    set({
      details,
      detailsHydrated: true,
      items,
      hydrated: true,
      manifest,
    });
  },

  loadDetail: async (id) => {
    const cached = get().details.get(id);
    if (cached) return cached;
    const raw = getMmkv().getString(`${KEY_PREFIX}${id}`);
    if (!raw) return null;
    try {
      const decoded = await decryptJson<Shoutout>(raw);
      const item: Shoutout = { ...decoded, createdAt: new Date(decoded.createdAt) };
      set((s) => {
        const nextDetails = new Map(s.details);
        nextDetails.set(id, item);
        return { details: nextDetails, items: detailsToItems(nextDetails) };
      });
      return item;
    } catch {
      return null;
    }
  },

  add: async (s) => {
    getMmkv().set(`${KEY_PREFIX}${s.id}`, await encryptJson(s));
    set((state) => {
      const nextDetails = new Map(state.details);
      nextDetails.set(s.id, s);
      const nextItems = detailsToItems(nextDetails);
      const nextManifest = nextItems.map(toShoutoutManifest);
      ManifestStorage.set(SHOUTOUTS_MANIFEST_SCOPE, nextManifest);
      return {
        details: nextDetails,
        items: nextItems,
        manifest: nextManifest,
      };
    });
  },

  remove: async (id) => {
    getMmkv().remove(`${KEY_PREFIX}${id}`);
    set((state) => {
      const nextDetails = new Map(state.details);
      nextDetails.delete(id);
      const nextItems = detailsToItems(nextDetails);
      const nextManifest = ManifestStorage.removeById<ShoutoutManifestEntry>(
        SHOUTOUTS_MANIFEST_SCOPE,
        id,
      );
      return {
        details: nextDetails,
        items: nextItems,
        manifest: nextManifest,
      };
    });
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

export type { ShoutoutManifestEntry } from './shoutoutManifest';
