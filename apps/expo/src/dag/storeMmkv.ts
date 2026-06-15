/**
 * MMKV-backed DagBackend — runtime implementation of the storage
 * interface defined in src/dag/store.ts. Kept in a separate file so the
 * pure unit-test path (Bun, no RN) doesn't pull react-native-mmkv
 * transitively.
 *
 * Every operation wraps `getMmkv()` in try/catch: if MMKV is not yet
 * initialised (cold start before app/_layout.tsx finishes init), the
 * operation degrades to a no-op rather than throwing. The Lab UI sees
 * an empty store until MMKV is ready; sandbox-acceptable per docs §3.2.
 */
import { getMmkv } from '@/storage/mmkv';

import type { DagBackend } from './store';

export class MmkvDagBackend implements DagBackend {
  get(key: string): string | undefined {
    try {
      const v = getMmkv().getString(key);
      return v === undefined || v === null ? undefined : v;
    } catch {
      return undefined;
    }
  }

  set(key: string, value: string): void {
    try {
      getMmkv().set(key, value);
    } catch {
      // MMKV not ready — drop. Sandbox UI shows empty state.
    }
  }

  delete(key: string): void {
    try {
      getMmkv().remove(key);
    } catch {
      // MMKV not ready — drop.
    }
  }

  keys(prefix?: string): readonly string[] {
    try {
      const all = getMmkv().getAllKeys() ?? [];
      return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
    } catch {
      return [];
    }
  }
}
