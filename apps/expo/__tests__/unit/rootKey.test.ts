/**
 * Root identity — seed-derived did:key (BIP-39 mnemonic -> HKDF -> P-256
 * scalar), the App<->Web portable identity from packages/shared/derive.ts
 * (04-plan Phase A1 task A1.4).
 *
 * TS port under test:
 *   apps/expo/src/identity/rootKey.ts
 *
 * What this suite pins:
 *   1. `createFromFreshMnemonic()` mints + persists a mnemonic, returning a
 *      did:key that `getRootDid()` reproduces on a later call.
 *   2. `getRootSigner()` returns a `Signer` whose output round-trips through
 *      `packages/shared`'s `signCompact` / `verifyCompact` (the actual
 *      Phase-A1 conformance contract every downstream phase depends on).
 *   3. Importing a pinned `packages/shared/vectors/derive.json` mnemonic
 *      reproduces the pinned did — the App<->Web portability guarantee.
 *   4. Re-importing the SAME mnemonic is idempotent (same did, no error).
 *   5. Face ID gating: `getRootSigner()`'s returned Signer rejects when the
 *      biometric prompt is denied; `revealMnemonicForExport()` returns
 *      `err({kind:'biometricDenied'})` without ever reading storage.
 *   6. `Result`-only error contract: not-provisioned / invalid-mnemonic
 *      never throw — always a typed `err(...)`.
 *   7. The mnemonic on disk is exactly what the injected `RootKeyStorage`
 *      received (never routed through MMKV — this file never mocks
 *      `@/storage/mmkv`).
 *
 * Isolation note: this suite deliberately uses ONLY rootKey.ts's own
 * dependency-injection hooks (`__setRootKeyStorageForTesting`,
 * `__setRootKeyBiometricGateForTesting`) instead of `mock.module('expo-
 * secure-store', ...)` / `mock.module('@/keychain/biometric', ...)`. Bun's
 * `mock.module` registry is GLOBAL for the whole `bun test` process — two
 * files independently mocking the same specifier with different fakes can
 * silently corrupt each OTHER's state once both are loaded in the same run
 * (reproduced empirically between `secretsKeychain.test.ts` and
 * `__tests__/parity/spruceDid.parity.test.ts`, which is why rootKey.ts's
 * SecureStore/biometric access is lazy-loaded + injectable in the first
 * place — see that module's doc). Do not add `mock.module` calls here.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import {
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  signCompact,
  verifyCompact,
  type Signer,
} from '@solidarity/shared';

import derivedVectors from '../../../../packages/shared/vectors/derive.json';
import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';

// ── In-memory storage + biometric gate, injected via rootKey.ts's own DI
//    hooks (no global `mock.module` — see the isolation note above) ───────

const secureStore = new Map<string, string>();
let nextBiometricSuccess = true;
const biometricCalls: string[] = [];
let mnemonicWriteGate: Promise<void> | null = null;
let releaseMnemonicWrite: (() => void) | null = null;
let mnemonicWriteStarted: (() => void) | null = null;

const fakeStorage = {
  getMnemonic: (): Promise<string | null> => Promise.resolve(secureStore.get('mnemonic') ?? null),
  setMnemonic: async (mnemonic: string): Promise<void> => {
    mnemonicWriteStarted?.();
    await (mnemonicWriteGate ?? Promise.resolve());
    secureStore.set('mnemonic', mnemonic);
  },
  deleteMnemonic: (): Promise<void> => {
    secureStore.delete('mnemonic');
    return Promise.resolve();
  },
};

const fakeBiometricGate = (reason: 'sign' | 'export'): Promise<boolean> => {
  biometricCalls.push(reason);
  return Promise.resolve(nextBiometricSuccess);
};

// ── Fake synchronizable-item storage (A1.5) — mirrors the real
//    secrets-vault-backed implementation's shape (`setSyncedMnemonic` /
//    `deleteSyncedMnemonic`) without touching the native module. ──────────

const syncStore = new Map<string, string>();
let nextSyncWriteError: Error | null = null;
let nextSyncDeleteError: Error | null = null;
let nextSyncReadError: Error | null = null;
let syncedWriteGate: Promise<void> | null = null;
let releaseSyncedWrite: (() => void) | null = null;
let syncedWriteStarted: (() => void) | null = null;

const fakeSyncStorage = {
  setSyncedMnemonic: async (mnemonic: string): Promise<void> => {
    if (nextSyncWriteError) return Promise.reject(nextSyncWriteError);
    syncedWriteStarted?.();
    await (syncedWriteGate ?? Promise.resolve());
    syncStore.set('mnemonic', mnemonic);
  },
  getSyncedMnemonic: (): Promise<string | null> => {
    if (nextSyncReadError) return Promise.reject(nextSyncReadError);
    return Promise.resolve(syncStore.get('mnemonic') ?? null);
  },
  deleteSyncedMnemonic: (): Promise<void> => {
    if (nextSyncDeleteError) return Promise.reject(nextSyncDeleteError);
    syncStore.delete('mnemonic');
    return Promise.resolve();
  },
};

interface RootKeyMod {
  readonly __setRootKeyStorageForTesting: (storage: typeof fakeStorage | null) => void;
  readonly __setRootKeyBiometricGateForTesting: (gate: typeof fakeBiometricGate | null) => void;
  readonly __setRootKeySyncStorageForTesting: (storage: typeof fakeSyncStorage | null) => void;
  readonly enableICloudBackup: () => Promise<
    | { readonly ok: true; readonly value: undefined }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } }
  >;
  readonly restoreRootKeyFromICloud: () => Promise<
    | { readonly ok: true; readonly value: { readonly kind: string; readonly did?: string } }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } }
  >;
  readonly getPortableBackupKey: () => Promise<
    | { readonly ok: true; readonly value: Uint8Array }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } }
  >;
  readonly clearSyncedRootKey: () => Promise<
    | { readonly ok: true; readonly value: undefined }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } }
  >;
  readonly createFromFreshMnemonic: () => Promise<
    | { readonly ok: true; readonly value: { readonly mnemonic: string; readonly did: string } }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } }
  >;
  readonly importFromMnemonic: (mnemonic: string) => Promise<
    | { readonly ok: true; readonly value: { readonly did: string } }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } }
  >;
  readonly deriveDidFromMnemonic: (mnemonic: string) =>
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly error: { readonly kind: string; readonly message?: string } };
  readonly getRootDid: () => Promise<
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly error: { readonly kind: string } }
  >;
  readonly getRootSigner: () => Promise<
    | { readonly ok: true; readonly value: Signer }
    | { readonly ok: false; readonly error: { readonly kind: string } }
  >;
  readonly revealMnemonicForExport: () => Promise<
    | { readonly ok: true; readonly value: string }
    | { readonly ok: false; readonly error: { readonly kind: string } }
  >;
  readonly hasRootKey: () => Promise<boolean>;
  readonly quiesceRootKeyOperations: () => Promise<void>;
  readonly deleteRootKey: () => Promise<void>;
  readonly deleteRootKeyForLocalWipe: () => Promise<
    | { readonly ok: true; readonly value: undefined }
    | { readonly ok: false; readonly error: { readonly kind: string } }
  >;
}

let mod: RootKeyMod;

beforeAll(async () => {
  const imported: unknown = await import('../../src/identity/rootKey');
  mod = imported as RootKeyMod;
  mod.__setRootKeyStorageForTesting(fakeStorage);
  mod.__setRootKeyBiometricGateForTesting(fakeBiometricGate);
  mod.__setRootKeySyncStorageForTesting(fakeSyncStorage);
});

beforeEach(async () => {
  secureStore.clear();
  syncStore.clear();
  nextBiometricSuccess = true;
  nextSyncWriteError = null;
  nextSyncDeleteError = null;
  nextSyncReadError = null;
  mnemonicWriteGate = null;
  releaseMnemonicWrite = null;
  mnemonicWriteStarted = null;
  syncedWriteGate = null;
  releaseSyncedWrite = null;
  syncedWriteStarted = null;
  __resetLocalDataWipeBarrierForTesting();
  biometricCalls.length = 0;
  await mod.deleteRootKey();
});

afterEach(async () => {
  __resetLocalDataWipeBarrierForTesting();
  await mod.deleteRootKey();
});

// ── 1. Create + resolve ────────────────────────────────────────────────────

describe('createFromFreshMnemonic / getRootDid', () => {
  it('mints a mnemonic + did, and getRootDid() reproduces the same did later', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.mnemonic.split(' ').length).toBe(24);
    expect(created.value.did.startsWith('did:key:z')).toBe(true);

    const resolved = await mod.getRootDid();
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value).toBe(created.value.did);
  });

  it('getRootDid() before provisioning returns err(notProvisioned)', async () => {
    const r = await mod.getRootDid();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('notProvisioned');
  });

  it('hasRootKey() reflects provisioning state', async () => {
    expect(await mod.hasRootKey()).toBe(false);
    await mod.createFromFreshMnemonic();
    expect(await mod.hasRootKey()).toBe(true);
  });

  it('persists the mnemonic verbatim via the injected storage (not MMKV — no MMKV mock exists in this file)', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stored = [...secureStore.values()];
    expect(stored).toContain(created.value.mnemonic);
  });
});

// ── 2. Signer output verifiable by verifyCompact ───────────────────────────

describe('getRootSigner — Phase A1 conformance contract', () => {
  it('the returned Signer produces a JWS verifyCompact accepts', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const signerResult = await mod.getRootSigner();
    expect(signerResult.ok).toBe(true);
    if (!signerResult.ok) return;

    const payload = { hello: 'root-key', n: 1 };
    const jws = await signCompact(payload, created.value.did, signerResult.value);
    const verified = verifyCompact(jws, created.value.did);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value).toEqual(payload);
  });

  it('getRootSigner() before provisioning returns err(notProvisioned)', async () => {
    const r = await mod.getRootSigner();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('notProvisioned');
  });

  it('the returned Signer gates every call behind Face ID and rejects on denial', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const signerResult = await mod.getRootSigner();
    expect(signerResult.ok).toBe(true);
    if (!signerResult.ok) return;

    nextBiometricSuccess = false;
    const digest = new Uint8Array(32).fill(7);
    await expect(signerResult.value(digest)).rejects.toThrow();
    expect(biometricCalls).toContain('presentProof');
  });
});

// ── 3. App<->Web portability vectors ───────────────────────────────────────

describe('derive.json vectors — App<->Web portability', () => {
  for (const v of derivedVectors.valid) {
    it(`importing "${v.name}" yields the pinned did`, async () => {
      const imported = await mod.importFromMnemonic(v.mnemonic);
      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      expect(imported.value.did).toBe(v.did);

      const resolved = await mod.getRootDid();
      expect(resolved.ok).toBe(true);
      if (resolved.ok) expect(resolved.value).toBe(v.did);
    });
  }

  for (const v of derivedVectors.invalid) {
    it(`importing invalid mnemonic "${v.name}" returns err(invalidMnemonic)`, async () => {
      const imported = await mod.importFromMnemonic(v.mnemonic);
      expect(imported.ok).toBe(false);
      if (imported.ok) return;
      expect(imported.error.kind).toBe('invalidMnemonic');
    });
  }

  it('deriveDidFromMnemonic is a pure function matching the pinned vector (no storage IO)', () => {
    const v = derivedVectors.valid[0]!;
    const a = mod.deriveDidFromMnemonic(v.mnemonic);
    const b = mod.deriveDidFromMnemonic(v.mnemonic);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value).toBe(v.did);
      expect(a.value).toBe(b.value);
    }
    expect(secureStore.size).toBe(0); // pure — never touched storage
  });
});

// ── 4. Re-import idempotency ────────────────────────────────────────────────

describe('importFromMnemonic — idempotent re-import', () => {
  it('importing the same mnemonic twice yields the same did both times', async () => {
    const v = derivedVectors.valid[0]!;
    const first = await mod.importFromMnemonic(v.mnemonic);
    const second = await mod.importFromMnemonic(v.mnemonic);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.did).toBe(second.value.did);
    expect(first.value.did).toBe(v.did);

    // Storage holds exactly one mnemonic value (overwritten, not duplicated).
    expect(secureStore.size).toBe(1);
  });

  it('switching to a DIFFERENT mnemonic changes the resolved did', async () => {
    const a = derivedVectors.valid[0]!;
    const b = derivedVectors.valid[1]!;
    await mod.importFromMnemonic(a.mnemonic);
    const switched = await mod.importFromMnemonic(b.mnemonic);
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.value.did).toBe(b.did);
    expect(switched.value.did).not.toBe(a.did);
  });

  it('does not recreate a root mnemonic when an in-flight import finishes after local wipe begins', async () => {
    mnemonicWriteGate = new Promise<void>((resolve) => {
      releaseMnemonicWrite = resolve;
    });
    const writeStarted = new Promise<void>((resolve) => {
      mnemonicWriteStarted = resolve;
    });

    const importing = mod.importFromMnemonic(derivedVectors.valid[0]!.mnemonic);
    await writeStarted;
    beginLocalDataWipe();
    let quiesced = false;
    const quiescing = mod.quiesceRootKeyOperations().then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);
    releaseMnemonicWrite?.();

    const result = await importing;
    await quiescing;
    expect(result.ok).toBe(false);
    expect(secureStore.size).toBe(0);
    completeLocalDataWipe();
  });
});

// ── 5. Export ceremony — Face ID gate ───────────────────────────────────────

describe('revealMnemonicForExport', () => {
  it('denies without reading storage when biometric fails', async () => {
    await mod.createFromFreshMnemonic();
    nextBiometricSuccess = false;
    const r = await mod.revealMnemonicForExport();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('biometricDenied');
    expect(biometricCalls).toContain('revealRecoveryBundle');
  });

  it('returns the exact persisted mnemonic when biometric succeeds', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const revealed = await mod.revealMnemonicForExport();
    expect(revealed.ok).toBe(true);
    if (revealed.ok) expect(revealed.value).toBe(created.value.mnemonic);
  });

  it('returns err(notProvisioned) when nothing has been provisioned yet', async () => {
    const r = await mod.revealMnemonicForExport();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('notProvisioned');
  });
});

// ── 6. enableICloudBackup — real synchronizable-item write (A1.5) ─────────

describe('enableICloudBackup', () => {
  it('returns err(notProvisioned) when no root key exists yet, and never touches sync storage', async () => {
    const r = await mod.enableICloudBackup();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('notProvisioned');
    expect(syncStore.size).toBe(0);
  });

  it('writes the exact persisted mnemonic to the synchronizable item and returns ok on success', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await mod.enableICloudBackup();
    expect(r.ok).toBe(true);
    expect(syncStore.get('mnemonic')).toBe(created.value.mnemonic);
  });

  it('returns err(storageFailed) and leaves the local mnemonic untouched when the synchronizable write fails', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    nextSyncWriteError = new Error('synchronizable keychain add failed status=-25299');
    const r = await mod.enableICloudBackup();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('storageFailed');
    expect(syncStore.size).toBe(0);

    // The local (mnemonic-ceremony) copy is untouched — the ceremony
    // fallback in BackupStep must still have a valid mnemonic to show.
    const stillLocal = await mod.getRootDid();
    expect(stillLocal.ok).toBe(true);
    if (stillLocal.ok) expect(stillLocal.value).toBe(created.value.did);
  });

  it('does not recreate the synchronizable mnemonic when backup finishes after local wipe begins', async () => {
    await mod.createFromFreshMnemonic();
    syncedWriteGate = new Promise<void>((resolve) => {
      releaseSyncedWrite = resolve;
    });
    const writeStarted = new Promise<void>((resolve) => {
      syncedWriteStarted = resolve;
    });

    const backingUp = mod.enableICloudBackup();
    await writeStarted;
    beginLocalDataWipe();
    releaseSyncedWrite?.();

    const result = await backingUp;
    expect(result.ok).toBe(false);
    expect(syncStore.size).toBe(0);
    completeLocalDataWipe();
  });
});

// ── 7. deleteRootKey — best-effort cleans the synchronizable item too ─────

describe('deleteRootKey', () => {
  it('clears both local and synced storage', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    const enabled = await mod.enableICloudBackup();
    expect(enabled.ok).toBe(true);
    expect(syncStore.size).toBe(1);

    await mod.deleteRootKey();

    expect(syncStore.size).toBe(0);
    expect(await mod.hasRootKey()).toBe(false);
  });

  it('never throws even when the synced-storage delete fails (best-effort)', async () => {
    await mod.createFromFreshMnemonic();
    nextSyncDeleteError = new Error('unsupported');
    // If this rejected, the `await` below would fail the test with an
    // unhandled rejection — that IS the "never throws" assertion.
    await mod.deleteRootKey();
    expect(await mod.hasRootKey()).toBe(false);
  });

  it('fails closed for a production wipe when synchronizable-key deletion fails', async () => {
    await mod.createFromFreshMnemonic();
    nextSyncDeleteError = new Error('private sync deletion failure');

    const result = await mod.deleteRootKeyForLocalWipe();

    expect(result).toEqual({ ok: false, error: { kind: 'storageFailed' } });
    expect(JSON.stringify(result)).not.toContain('private sync deletion failure');
    nextSyncDeleteError = null;
  });
});

// ── 7b. restoreRootKeyFromICloud — fresh-device read-back (write-only fix) ─

describe('restoreRootKeyFromICloud', () => {
  it('rehydrates the synced mnemonic on a fresh device and returns the same did', async () => {
    // Device A: provision + back up to iCloud.
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await mod.enableICloudBackup();

    // Simulate device B: local storage empty, shared sync store retained.
    secureStore.clear();
    expect(await mod.hasRootKey()).toBe(false);

    const restored = await mod.restoreRootKeyFromICloud();
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.kind).toBe('restoredFromICloud');
    expect(restored.value.did).toBe(created.value.did);

    // Now resolvable locally — the identity survived the "device swap".
    expect(await mod.hasRootKey()).toBe(true);
    const did = await mod.getRootDid();
    expect(did.ok).toBe(true);
    if (did.ok) expect(did.value).toBe(created.value.did);
  });

  it('local wins: never overwrites an existing local phrase with the synced one', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // A DIFFERENT phrase sits in the synced store.
    syncStore.set('mnemonic', 'legal winner thank year wave sausage worth useful legal winner thank yellow');

    const restored = await mod.restoreRootKeyFromICloud();
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.kind).toBe('alreadyLocal');
    if (created.ok) expect(restored.value.did).toBe(created.value.did);
  });

  it('returns notFound (not an error) when nothing is synced and nothing is local', async () => {
    const restored = await mod.restoreRootKeyFromICloud();
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.kind).toBe('notFound');
  });

  it('a malformed synced phrase is a typed error, NEVER a silent fresh mint', async () => {
    syncStore.set('mnemonic', 'not a valid bip39 phrase at all nope nope nope');
    const restored = await mod.restoreRootKeyFromICloud();
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.error.kind).toBe('invalidMnemonic');
    // Must not have persisted anything locally.
    expect(await mod.hasRootKey()).toBe(false);
  });

  it('surfaces a keychain read failure as a typed storage error (never a fresh mint)', async () => {
    nextSyncReadError = new Error('synchronizable keychain read failed status=-25300');
    const restored = await mod.restoreRootKeyFromICloud();
    expect(restored.ok).toBe(false);
    if (restored.ok) return;
    expect(restored.error.kind).toBe('storageFailed');
    expect(await mod.hasRootKey()).toBe(false);
  });
});

// ── 7c. getPortableBackupKey — recovery-phrase-derived AES key ────────────

describe('getPortableBackupKey', () => {
  it('returns a deterministic 32-byte key for the provisioned phrase without a biometric prompt', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const a = await mod.getPortableBackupKey();
    const b = await mod.getPortableBackupKey();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.length).toBe(32);
    expect(Buffer.from(a.value).toString('hex')).toBe(Buffer.from(b.value).toString('hex'));
    // No Face ID prompt — background backups must not gate on biometrics.
    expect(biometricCalls).not.toContain('presentProof');
    expect(biometricCalls).not.toContain('revealRecoveryBundle');
  });

  it('matches the shared derivation vector for a pinned phrase', async () => {
    await mod.importFromMnemonic(
      'legal winner thank year wave sausage worth useful legal winner thank yellow'
    );
    const key = await mod.getPortableBackupKey();
    expect(key.ok).toBe(true);
    if (!key.ok) return;
    expect(Buffer.from(key.value).toString('hex')).toBe(
      '0b3d69a14fcec6046218fe3c889f61206f64e6e0271aad1723e42cdad6653c70'
    );
  });

  it('returns notProvisioned when no root key exists', async () => {
    const key = await mod.getPortableBackupKey();
    expect(key.ok).toBe(false);
    if (key.ok) return;
    expect(key.error.kind).toBe('notProvisioned');
  });
});

// ── 7d. clearSyncedRootKey — identity-switch cleanup ──────────────────────

describe('clearSyncedRootKey', () => {
  it('removes ONLY the synced phrase, leaving the local copy intact', async () => {
    const created = await mod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    await mod.enableICloudBackup();
    expect(syncStore.size).toBe(1);

    const cleared = await mod.clearSyncedRootKey();
    expect(cleared.ok).toBe(true);
    expect(syncStore.size).toBe(0); // synced phrase gone …
    expect(await mod.hasRootKey()).toBe(true); // … local identity untouched
  });

  it('returns a typed storageFailed (never swallows) when the delete fails', async () => {
    await mod.createFromFreshMnemonic();
    nextSyncDeleteError = new Error('unsupported on this platform');
    const cleared = await mod.clearSyncedRootKey();
    expect(cleared.ok).toBe(false);
    if (cleared.ok) return;
    expect(cleared.error.kind).toBe('storageFailed');
  });
});

// ── 8. did derivation cross-checks against packages/shared primitives ─────

describe('did derivation matches packages/shared primitives directly', () => {
  it('deriveDidFromMnemonic matches didKeyFromPublicKey(publicKeyFromPrivate(deriveP256Scalar(...)))', async () => {
    const { deriveP256Scalar, HKDF_INFO_ROOT } = await import('@solidarity/shared');
    const v = derivedVectors.valid[1]!;
    const expected = didKeyFromPublicKey(publicKeyFromPrivate(deriveP256Scalar(v.mnemonic, HKDF_INFO_ROOT)));
    const actual = mod.deriveDidFromMnemonic(v.mnemonic);
    expect(actual.ok).toBe(true);
    if (actual.ok) expect(actual.value).toBe(expected);
  });
});
