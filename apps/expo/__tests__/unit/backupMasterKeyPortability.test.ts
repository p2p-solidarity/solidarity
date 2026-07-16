/**
 * Backup DATA (SOLB) master-key portability — GAP demonstration
 * (diagnosis 2026-07-16).
 *
 * Reproduces the second half of "私鑰跨裝置沒辦法還原 / 資料無法還原": the
 * cards/contacts/credentials backup file is AES-GCM-sealed with the master
 * encryption key from `src/storage/secureMasterKey.ts`
 * (`gg.solidarity.master.v2`). That key is stored via `expo-secure-store`
 * with NO `kSecAttrSynchronizable`, so it is DEVICE-LOCAL — it does not travel
 * through iCloud Keychain and is not carried inside the backup itself
 * (chicken-and-egg: the key that would decrypt the file isn't in the file).
 *
 * Consequence: on a second device (or any install where `getMasterKey()`
 * mints a fresh random key), `restoreFromBackup()` downloads the `.solbk`
 * file, `decodeSolb()` succeeds, but `aesGcmOpen()` fails the auth tag →
 * `DecryptError` → `BackupRestoreError('key-mismatch')`. The user's data is
 * intact in iCloud Drive but permanently unreadable on the new device.
 *
 * This test drives the REAL SOLB envelope (`encodeSolb`/`decodeSolb`) plus the
 * same shared AES-GCM primitives `encryptionManager` uses, so it characterises
 * the actual file path — only `getMasterKey()`'s device-local storage is
 * modelled by using two different keys. The existing
 * `icloudBackupRoundtrip.test.ts` only ever uses ONE fixed key, so this
 * cross-device failure mode is otherwise untested.
 */
import { describe, expect, it } from 'bun:test';

import {
  aesGcmOpen,
  aesGcmSeal,
  base64Decode,
  base64Encode,
  bytesToUtf8,
  generateAesKey,
  utf8ToBytes,
} from '@solidarity/shared';

import { decodeSolb, encodeSolb } from '../../src/backup/solbEnvelope';

/** Mirror of encryptionManager.encryptJson, with an explicit key (= per-device
 *  getMasterKey()). Produces the exact base64 the cloud provider frames. */
function sealPayload(key: Uint8Array, value: unknown): string {
  return base64Encode(aesGcmSeal(key, utf8ToBytes(JSON.stringify(value))));
}

/** Mirror of encryptionManager.decryptJson — throws on auth-tag failure. */
function openPayload<T>(key: Uint8Array, ciphertextB64: string): T {
  const plaintext = aesGcmOpen(key, base64Decode(ciphertextB64)); // throws on wrong key
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}

const PAYLOAD = {
  schemaVersion: 3 as const,
  cards: [{ id: 'c1', name: 'Ada Lovelace' }],
  contacts: [{ id: 'p1', name: 'Alan Turing' }],
};

describe('SOLB backup is decryptable ONLY on the device that sealed it', () => {
  it('same key (same device / reinstall where the keychain item survived) restores cleanly', () => {
    const deviceKey = generateAesKey();
    const solbFile = encodeSolb(sealPayload(deviceKey, PAYLOAD));

    // Restore on the same device: header strips, AES-GCM opens, JSON matches.
    const restored = openPayload<typeof PAYLOAD>(deviceKey, decodeSolb(solbFile));
    expect(restored).toEqual(PAYLOAD);
  });

  it('a DIFFERENT device key (fresh install, no iCloud-synced master key) fails the auth tag', () => {
    // Device A seals the backup with its local master key.
    const deviceAKey = generateAesKey();
    const solbFile = encodeSolb(sealPayload(deviceAKey, PAYLOAD));

    // Device B: getMasterKey() has no synced/legacy key to recover, so it
    // generated a fresh random key. The SOLB framing still parses …
    const deviceBKey = generateAesKey();
    const ciphertextB64 = decodeSolb(solbFile);
    expect(ciphertextB64.length).toBeGreaterThan(0);

    // … but the AES-GCM open fails — this is what surfaces as DecryptError →
    // BackupRestoreError('key-mismatch') in restoreFromBackup(). The data is
    // present but unreadable: the classic cross-device restore failure.
    expect(() => openPayload(deviceBKey, ciphertextB64)).toThrow();

    // Sanity: the two device keys really are independent (nothing synced them).
    expect(base64Encode(deviceAKey)).not.toBe(base64Encode(deviceBKey));
  });
});
