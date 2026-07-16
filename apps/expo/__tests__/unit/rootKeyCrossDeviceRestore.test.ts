/**
 * Root-key cross-device restore — behavioral test (fixed 2026-07-16).
 *
 * This file originally CHARACTERIZED the write-only gap: `enableICloudBackup()`
 * wrote the mnemonic to iCloud Keychain but nothing read it back, so a second
 * device could not recover the identity. `restoreRootKeyFromICloud()` closes
 * that gap; this suite now asserts the DESIRED behavior — device B recovers the
 * exact same Root Identity from the synced Recovery Phrase.
 *
 * Model (same as before): iCloud Keychain is a store SHARED across a user's
 * devices on one Apple ID (`sharedICloudKeychain`); each device's
 * `expo-secure-store` is device-LOCAL (`deviceLocal`). Uses ONLY rootKey.ts's
 * DI hooks — no native modules, no mock.module (rootKey isolation contract).
 */
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import * as rootKeyModule from '../../src/identity/rootKey';

// Shared iCloud Keychain — survives a device swap on one Apple ID.
const sharedICloudKeychain = new Map<string, string>();
// Per-device local SecureStore (WHEN_UNLOCKED_THIS_DEVICE_ONLY).
let deviceLocal = new Map<string, string>();

function makeLocalStorage(store: Map<string, string>) {
  return {
    getMnemonic: (): Promise<string | null> => Promise.resolve(store.get('mnemonic') ?? null),
    setMnemonic: (m: string): Promise<void> => {
      store.set('mnemonic', m);
      return Promise.resolve();
    },
    deleteMnemonic: (): Promise<void> => {
      store.delete('mnemonic');
      return Promise.resolve();
    },
  };
}

// Sync storage now includes the read-back path (`getSyncedMnemonic`) — the
// piece whose absence was the gap.
const syncStorage = {
  setSyncedMnemonic: (m: string): Promise<void> => {
    sharedICloudKeychain.set('mnemonic', m);
    return Promise.resolve();
  },
  getSyncedMnemonic: (): Promise<string | null> =>
    Promise.resolve(sharedICloudKeychain.get('mnemonic') ?? null),
  deleteSyncedMnemonic: (): Promise<void> => {
    sharedICloudKeychain.delete('mnemonic');
    return Promise.resolve();
  },
};

function useDevice(store: Map<string, string>): void {
  rootKeyModule.__setRootKeyStorageForTesting(makeLocalStorage(store));
}

beforeAll(() => {
  rootKeyModule.__setRootKeyBiometricGateForTesting(() => Promise.resolve(true));
  rootKeyModule.__setRootKeySyncStorageForTesting(syncStorage);
});

beforeEach(() => {
  sharedICloudKeychain.clear();
  deviceLocal = new Map();
  useDevice(deviceLocal);
});

describe('root-key iCloud backup is restorable across devices', () => {
  it('device B recovers the SAME Root Identity device A backed up to iCloud', async () => {
    // Device A: onboard + opt into iCloud Keychain backup.
    const deviceALocal = new Map<string, string>();
    useDevice(deviceALocal);
    const created = await rootKeyModule.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const didA = created.value.did;
    const enabled = await rootKeyModule.enableICloudBackup();
    expect(enabled.ok).toBe(true);

    // Device B: fresh install, same Apple ID (shared keychain synced).
    const deviceBLocal = new Map<string, string>();
    useDevice(deviceBLocal);
    expect(await rootKeyModule.hasRootKey()).toBe(false); // nothing local yet

    const recovered = await rootKeyModule.restoreRootKeyFromICloud();
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    if (recovered.value.kind === 'notFound') throw new Error('expected a recovery, got notFound');
    expect(recovered.value.kind).toBe('restoredFromICloud');
    expect(recovered.value.did).toBe(didA);

    // The identity now resolves locally on device B — no orphaning, no fresh mint.
    expect(await rootKeyModule.hasRootKey()).toBe(true);
    const resolved = await rootKeyModule.getRootDid();
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value).toBe(didA);
  });

  it('device B derives the identical Portable Backup Key after recovery', async () => {
    const deviceALocal = new Map<string, string>();
    useDevice(deviceALocal);
    const created = await rootKeyModule.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await rootKeyModule.enableICloudBackup();
    const keyA = await rootKeyModule.getPortableBackupKey();
    expect(keyA.ok).toBe(true);

    const deviceBLocal = new Map<string, string>();
    useDevice(deviceBLocal);
    await rootKeyModule.restoreRootKeyFromICloud();
    const keyB = await rootKeyModule.getPortableBackupKey();
    expect(keyB.ok).toBe(true);
    if (!keyA.ok || !keyB.ok) return;

    // Same phrase → same backup key → device B can decrypt device A's v2 archive.
    expect(Buffer.from(keyB.value).toString('hex')).toBe(
      Buffer.from(keyA.value).toString('hex')
    );
  });

  it('nothing synced → notFound (caller offers Retry / Enter Phrase / Start Fresh), never a silent new identity', async () => {
    const deviceBLocal = new Map<string, string>();
    useDevice(deviceBLocal);
    const recovered = await rootKeyModule.restoreRootKeyFromICloud();
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.value.kind).toBe('notFound');
    expect(await rootKeyModule.hasRootKey()).toBe(false);
  });
});
