/**
 * CacheService — two-tier cache for screen-render performance.
 *
 * Tier 1 (hot, sync): encrypted MMKV. `getSync<T>(key)` returns the JSON-
 * decoded value or null on the same tick, which is what Rule 10 (never
 * await on first paint) requires for `useState(() => CacheService.getSync(...))`.
 *
 * Tier 2 (cold, async): SQLite via expo-sqlite. Holds large blobs we don't
 * want bloating the encrypted MMKV instance (received-card list, shoutout
 * threads, identity card payloads). Reads on a cache miss fall through to
 * SQLite, then promote the value into MMKV so the next render is hot.
 *
 * Why both? MMKV is sync and tiny but encrypted-write cost grows with
 * payload size, and the whole store is loaded into memory. SQLite is
 * async but scales — keep MMKV for "always-needed-on-render-path" UI
 * state and let SQLite hold the long tail.
 *
 * Cold store is opened lazily; an unopened backend just degrades to MMKV-
 * only, so this module is safe to import before native modules are ready.
 */
import * as SQLite from 'expo-sqlite';

import { getMmkv } from './mmkv';

const TABLE = 'cache_v1';
const DB_NAME = 'solidarity-cache.db';

interface ColdStore {
  readonly get: (key: string) => Promise<string | null>;
  readonly set: (key: string, value: string, ts: number) => Promise<void>;
  readonly delete: (key: string) => Promise<void>;
}

let coldPromise: Promise<ColdStore | null> | null = null;

async function openCold(): Promise<ColdStore | null> {
  if (!coldPromise) {
    coldPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync(DB_NAME);
        await db.execAsync(
          `CREATE TABLE IF NOT EXISTS ${TABLE} (
             k TEXT PRIMARY KEY NOT NULL,
             v TEXT NOT NULL,
             ts INTEGER NOT NULL
           );`
        );
        return {
          get: async (key: string) => {
            const row = await db.getFirstAsync<{ v: string }>(
              `SELECT v FROM ${TABLE} WHERE k = ? LIMIT 1;`,
              [key]
            );
            return row?.v ?? null;
          },
          set: async (key: string, value: string, ts: number) => {
            await db.runAsync(
              `INSERT INTO ${TABLE}(k, v, ts) VALUES (?, ?, ?)
                 ON CONFLICT(k) DO UPDATE SET v = excluded.v, ts = excluded.ts;`,
              [key, value, ts]
            );
          },
          delete: async (key: string) => {
            await db.runAsync(`DELETE FROM ${TABLE} WHERE k = ?;`, [key]);
          },
        };
      } catch {
        // SQLite isn't available (Expo Go without the dev client, etc.) —
        // degrade gracefully to MMKV-only and never poll again.
        return null;
      }
    })();
  }
  return coldPromise;
}

function tsKey(key: string): string { return `cache:ts:${key}`; }

export interface CacheEntryMeta {
  readonly storedAt: number;
  readonly ageMs: number;
}

export const CacheService = {
  /**
   * Synchronous hot read — call inside `useState(() => …)` so the first
   * render is non-null on a warm hit. Returns `null` on miss; never blocks.
   */
  getSync<T>(key: string): T | null {
    try {
      const raw = getMmkv().getString(`cache:${key}`);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  /**
   * Async read — hot first, falls through to cold and promotes on hit.
   * Use this for background revalidation only (initial state should come
   * from `getSync`).
   */
  async get<T>(key: string): Promise<T | null> {
    const hot = this.getSync<T>(key);
    if (hot !== null) return hot;
    const cold = await openCold();
    if (!cold) return null;
    const raw = await cold.get(key);
    if (!raw) return null;
    try {
      const value = JSON.parse(raw) as T;
      // Promote into MMKV so the next sync render is hot.
      getMmkv().set(`cache:${key}`, raw);
      return value;
    } catch {
      return null;
    }
  },

  /** Stale-while-revalidate. Returns the cached value + age in ms. */
  async getWithMeta<T>(
    key: string,
  ): Promise<{ readonly value: T; readonly meta: CacheEntryMeta } | null> {
    const value = await this.get<T>(key);
    if (value === null) return null;
    const ts = Number(getMmkv().getString(tsKey(key)) ?? '0');
    const storedAt = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    return { value, meta: { storedAt, ageMs: Date.now() - storedAt } };
  },

  /** Write-through: hot synchronously, cold async + best-effort. */
  set<T>(key: string, value: T): void {
    const raw = JSON.stringify(value);
    const now = Date.now();
    try {
      const k = getMmkv();
      k.set(`cache:${key}`, raw);
      k.set(tsKey(key), String(now));
    } catch {
      // MMKV not ready yet — render-path UI keeps in-memory state.
    }
    void openCold().then((cold) => {
      if (cold) void cold.set(key, raw, now).catch(() => undefined);
    });
  },

  /** Drop both tiers for a key. */
  delete(key: string): void {
    try {
      const k = getMmkv();
      k.remove(`cache:${key}`);
      k.remove(tsKey(key));
    } catch {
      // ignore
    }
    void openCold().then((cold) => {
      if (cold) void cold.delete(key).catch(() => undefined);
    });
  },
};
