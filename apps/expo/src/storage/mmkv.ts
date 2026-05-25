/**
 * Encrypted MMKV — source of truth for synchronous local KV. Mirrors
 * UserDefaults + StorageManager.swift.
 *
 * react-native-mmkv v4 dropped the `class MMKV` constructor; instances
 * are now built via the `createMMKV(config)` factory (Nitro under the
 * hood). The factory returns a `MMKV` *interface* — we keep our own
 * `getMmkv()` helper so consumers don't worry about lazy init.
 *
 * The live instance is stashed on `globalThis` so it survives Fast
 * Refresh — without this, every HMR cycle nukes the module-level
 * `instance` reference and screens calling `getMmkv()` throw
 * "MMKV not initialised" until the next full reload.
 *
 * Usage:
 *   await initMmkv();             // call once at app launch (root layout)
 *   getMmkv().set('k', 'v');
 */
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';

import { createMmkvConfig } from './mmkvConfig';
import { getMasterKey } from './secureMasterKey';

const GLOBAL_KEY = '__solidarity_mmkv__';
const PENDING_KEY = '__solidarity_mmkv_pending__';

interface MmkvGlobal {
  [GLOBAL_KEY]?: MMKV;
  [PENDING_KEY]?: Promise<MMKV>;
}

const slot = globalThis as unknown as MmkvGlobal;

/** Lazily initialise MMKV with the master key as encryption passphrase. */
export async function initMmkv(): Promise<MMKV> {
  const existing = slot[GLOBAL_KEY];
  if (existing) return existing;
  // Coalesce concurrent callers — boot useEffect + a screen mount could
  // both kick off init on the same tick, and Secure Store IO isn't free.
  const pending = slot[PENDING_KEY];
  if (pending) return pending;
  const promise = (async () => {
    try {
      const masterKey = await getMasterKey();
      const created = createMMKV(createMmkvConfig(masterKey));
      slot[GLOBAL_KEY] = created;
      return created;
    } finally {
      delete slot[PENDING_KEY];
    }
  })();
  slot[PENDING_KEY] = promise;
  return promise;
}

/** Sync accessor — call only AFTER `initMmkv()` has resolved. */
export function getMmkv(): MMKV {
  const existing = slot[GLOBAL_KEY];
  if (!existing) {
    throw new Error('MMKV not initialised — call initMmkv() at app launch');
  }
  return existing;
}
