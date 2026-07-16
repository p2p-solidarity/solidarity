/**
 * Root-key cross-device restore — GAP demonstration (diagnosis 2026-07-16).
 *
 * Reproduces the user-reported symptom "私鑰跨裝置沒辦法還原" (the identity
 * private key can't be restored on another device) at the pure-logic level,
 * using ONLY rootKey.ts's own DI hooks (no native modules, no mock.module —
 * same isolation contract as rootKey.test.ts).
 *
 * The model: iCloud Keychain is a store SHARED across a user's devices on one
 * Apple ID (`sharedICloudKeychain`), while each device's `expo-secure-store`
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) is device-LOCAL (`deviceLocal*`).
 *
 * Finding: `enableICloudBackup()` WRITES the mnemonic into the shared store,
 * but NOTHING in the app ever READS it back — `getRootDid()`/`hasRootKey()`
 * only ever consult the device-local copy, and the barrel exposes no
 * `restoreFromICloud` / `getSyncedMnemonic`. So on a second device the synced
 * mnemonic is present-but-unreachable: onboarding's BackupStep sees
 * `hasRootKey() === false` and mints a BRAND-NEW identity, silently orphaning
 * the backed-up one. The data survives in the keychain; only the app-layer
 * read path is missing.
 *
 * These tests assert the CURRENT (broken) reality so they live green in the
 * suite as executable documentation of the gap. When a real restore path is
 * added, the `// DESIRED once fixed:` lines below become the new assertions.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import * as rootKeyModule from '../../src/identity/rootKey';

// ── Shared iCloud Keychain: survives a "device swap" (one Apple ID) ─────────
const sharedICloudKeychain = new Map<string, string>();

// ── Per-device local SecureStore (WHEN_UNLOCKED_THIS_DEVICE_ONLY) ───────────
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

// Sync storage mirrors the real secrets-vault-backed shape: write + delete
// only — there is deliberately NO getSyncedMnemonic to wire, which is the gap.
const syncStorage = {
  setSyncedMnemonic: (m: string): Promise<void> => {
    sharedICloudKeychain.set('mnemonic', m);
    return Promise.resolve();
  },
  deleteSyncedMnemonic: (): Promise<void> => {
    sharedICloudKeychain.delete('mnemonic');
    return Promise.resolve();
  },
};

/** Point rootKey.ts at a given device's local store (keeps shared sync store). */
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

describe('root-key iCloud "backup" is WRITE-ONLY (cross-device restore gap)', () => {
  it('device B cannot recover the identity even though device A enabled iCloud backup', async () => {
    // ── Device A: onboard + opt into iCloud Keychain backup ──────────────
    const deviceALocal = new Map<string, string>();
    useDevice(deviceALocal);

    const created = await rootKeyModule.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const didA = created.value.did;

    const enabled = await rootKeyModule.enableICloudBackup();
    expect(enabled.ok).toBe(true); // the WRITE succeeds …
    // … and the mnemonic really did land in the shared iCloud Keychain:
    expect(sharedICloudKeychain.get('mnemonic')).toBe(created.value.mnemonic);

    // ── Device B: fresh install, SAME Apple ID (shared keychain synced) ──
    const deviceBLocal = new Map<string, string>(); // device-local: empty
    useDevice(deviceBLocal);

    // The synced mnemonic IS physically present in the shared keychain …
    expect(sharedICloudKeychain.has('mnemonic')).toBe(true);

    // … but the app has no read-back path, so device B looks un-provisioned.
    // This is exactly what onboarding's BackupStep observes → it then mints a
    // fresh identity and orphans didA.
    expect(await rootKeyModule.hasRootKey()).toBe(false);
    const resolved = await rootKeyModule.getRootDid();
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.error.kind).toBe('notProvisioned');

    // DESIRED once a restore path exists:
    //   expect(await rootKeyModule.hasRootKey()).toBe(true)
    //   expect((await rootKeyModule.getRootDid()).value).toBe(didA)
    // Kept as a comment so this test documents the gap without going red.
    void didA;
  });

  it('the backed-up mnemonic IS recoverable — the only missing piece is the read path', async () => {
    // Device A backs up.
    const deviceALocal = new Map<string, string>();
    useDevice(deviceALocal);
    const created = await rootKeyModule.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await rootKeyModule.enableICloudBackup();
    const didA = created.value.did;

    // Device B: simulate what a restore path WOULD do — read the synced value
    // (the app currently never does this) and hand it to importFromMnemonic.
    const deviceBLocal = new Map<string, string>();
    useDevice(deviceBLocal);
    const syncedMnemonic = sharedICloudKeychain.get('mnemonic');
    expect(syncedMnemonic).toBeDefined();
    const restored = await rootKeyModule.importFromMnemonic(syncedMnemonic!);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;

    // Same identity comes back — proving the data is fine and the fix is
    // purely "read the synced item on a fresh device", not a crypto change.
    expect(restored.value.did).toBe(didA);
    expect((await rootKeyModule.getRootDid()).ok).toBe(true);
  });

  it('rootKey barrel exposes a WRITE (enableICloudBackup) but no restore/read counterpart', () => {
    const surface = rootKeyModule as unknown as Record<string, unknown>;
    // The write side exists …
    expect(typeof surface['enableICloudBackup']).toBe('function');
    // … but there is no automatic restore / synced-read export. If someone
    // adds one, flip these to `toBe('function')` and wire the tests above.
    expect(surface['restoreFromICloud']).toBeUndefined();
    expect(surface['getSyncedMnemonic']).toBeUndefined();
    expect(surface['restoreRootKeyFromICloud']).toBeUndefined();
  });
});
