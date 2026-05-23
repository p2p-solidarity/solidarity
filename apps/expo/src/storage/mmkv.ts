/**
 * Encrypted MMKV — source of truth for synchronous local KV. Mirrors
 * UserDefaults + StorageManager.swift.
 *
 * react-native-mmkv v4 dropped the `class MMKV` constructor; instances
 * are now built via the `createMMKV(config)` factory (Nitro under the
 * hood). The factory returns a `MMKV` *interface* — we keep our own
 * `getMmkv()` helper so consumers don't worry about lazy init.
 *
 * Usage:
 *   await initMmkv();             // call once at app launch (root layout)
 *   solidarityStore.set('k', 'v');
 */
import { createMMKV } from 'react-native-mmkv';
import type { MMKV } from 'react-native-mmkv';

import { base64Encode } from '@solidarity/shared';

import { getMasterKey } from './secureMasterKey';

const INSTANCE_ID = 'solidarity';

let instance: MMKV | null = null;

/** Lazily initialise MMKV with the master key as encryption passphrase. */
export async function initMmkv(): Promise<MMKV> {
  if (instance) return instance;
  const masterKey = await getMasterKey();
  const created = createMMKV({
    id: INSTANCE_ID,
    encryptionKey: base64Encode(masterKey),
  });
  instance = created;
  return created;
}

/** Sync accessor — call only AFTER `initMmkv()` has resolved. */
export function getMmkv(): MMKV {
  if (!instance) {
    throw new Error('MMKV not initialised — call initMmkv() at app launch');
  }
  return instance;
}
