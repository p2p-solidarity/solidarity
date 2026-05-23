/**
 * Encrypted MMKV — the source-of-truth local KV store. Mirrors the role of
 * UserDefaults + StorageManager.swift in the Swift app.
 *
 * MMKV's built-in encryption derives an AES key from the supplied passphrase,
 * which is itself bound to our master key (held in Keychain/Keystore via
 * expo-secure-store). Combining MMKV-AES + Keychain-bound passphrase gives:
 *   - sync read/write on the JS thread (MMKV is native + memory-mapped)
 *   - at-rest encryption that survives device backup without leaking
 *
 * Usage:
 *   await initMmkv();           // call once at app launch
 *   solidarityStore.set('k', 'v');
 */
import { MMKV } from 'react-native-mmkv';

import { base64Encode } from '@solidarity/shared';

import { getMasterKey } from './secureMasterKey';

const INSTANCE_ID = 'solidarity';

let instance: MMKV | null = null;

/** Lazily initialise MMKV with the master key as encryption passphrase. */
export async function initMmkv(): Promise<MMKV> {
  if (instance) return instance;
  const masterKey = await getMasterKey();
  instance = new MMKV({
    id: INSTANCE_ID,
    encryptionKey: base64Encode(masterKey),
  });
  return instance;
}

/** Sync accessor — call only AFTER `initMmkv()` has resolved. */
export function getMmkv(): MMKV {
  if (!instance) {
    throw new Error('MMKV not initialised — call initMmkv() at app launch');
  }
  return instance;
}
