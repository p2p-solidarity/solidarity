/**
 * Profile store — local Profile Record persistence + append-only save flow
 * (1.3.3 Task A2.2, apps/expo/src/profile/store.ts).
 *
 * What this suite pins:
 *   1. `saveProfile` constructs a record that `verifyCompact` accepts as
 *      signed by the active root did — the actual conformance contract.
 *   2. Invalid fields (bad link URL) return `err(...)` BEFORE
 *      `getRootSigner()` is ever called — no Face ID prompt on a doomed
 *      save — and nothing is written to MMKV.
 *   3. No provisioned root key → `err(...)`, no Face ID prompt either.
 *   4. `updatedAt` is strictly monotonic across successive saves, and each
 *      save replaces the stored record wholesale (a fresh object, never a
 *      mutation of the previous one) — the append-only contract.
 *   5. Fields not exposed by the editor (`avatar`/`alsoKnownAs`/`badges`/
 *      `supersededBy`) carry forward as real empties, never fabricated.
 *   6. `hydrateProfile()` round-trips a save through the MMKV mock after an
 *      in-memory reset (simulated app restart), and fails closed to
 *      `'empty'` on missing/corrupt persisted data.
 *
 * Isolation: mocks ONLY `@/storage/mmkv` (this store's own persistence
 * layer — same pattern as `groupStore.test.ts`) and drives the REAL
 * root-key signing path through `rootKey.ts`'s own DI seams
 * (`__setRootKeyStorageForTesting` / `__setRootKeyBiometricGateForTesting`)
 * instead of `mock.module('@/identity', ...)` — see `rootKey.test.ts`'s
 * isolation note for why a global `mock.module` on the same specifier two
 * files both touch is avoided.
 */
import { beforeAll, beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';

import { verifyCompact, type ProfileRecord } from '@solidarity/shared';

interface ProfileFieldsShape {
  readonly displayName: string;
  readonly bio: string;
  readonly links: readonly { readonly label: string; readonly url: string }[];
}

type SaveResult =
  | { readonly ok: true; readonly value: undefined }
  | { readonly ok: false; readonly error: string };

interface ProfileModuleSurface {
  readonly useProfileStore: {
    getState: () => {
      readonly record: ProfileRecord | null;
      readonly jws: string | null;
      readonly status: 'empty' | 'ready';
      readonly saveProfile: (fields: ProfileFieldsShape) => Promise<SaveResult>;
    };
    setState: (
      s: Partial<{ record: ProfileRecord | null; jws: string | null; status: 'empty' | 'ready' }>
    ) => void;
  };
  readonly hydrateProfile: () => void;
}

interface RootKeyModuleSurface {
  readonly __setRootKeyStorageForTesting: (storage: unknown) => void;
  readonly __setRootKeyBiometricGateForTesting: (gate: unknown) => void;
  readonly createFromFreshMnemonic: () => Promise<
    | { readonly ok: true; readonly value: { readonly mnemonic: string; readonly did: string } }
    | { readonly ok: false; readonly error: { readonly kind: string } }
  >;
  readonly deleteRootKey: () => Promise<void>;
}

const kv = new Map<string, string>();
const secureStore = new Map<string, string>();
let nextBiometricSuccess = true;
const biometricCalls: string[] = [];

let mod: ProfileModuleSurface;
let rootKeyMod: RootKeyModuleSurface;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (k: string): string | undefined => kv.get(k),
      set: (k: string, v: string): void => {
        kv.set(k, v);
      },
      remove: (k: string): void => {
        kv.delete(k);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
    }),
    initMmkv: async (): Promise<undefined> => undefined,
  }));

  rootKeyMod = (await import('../../src/identity/rootKey')) as unknown as RootKeyModuleSurface;
  rootKeyMod.__setRootKeyStorageForTesting({
    getMnemonic: (): Promise<string | null> => Promise.resolve(secureStore.get('mnemonic') ?? null),
    setMnemonic: (mnemonic: string): Promise<void> => {
      secureStore.set('mnemonic', mnemonic);
      return Promise.resolve();
    },
    deleteMnemonic: (): Promise<void> => {
      secureStore.delete('mnemonic');
      return Promise.resolve();
    },
  });
  rootKeyMod.__setRootKeyBiometricGateForTesting((reason: 'sign' | 'export'): Promise<boolean> => {
    biometricCalls.push(reason);
    return Promise.resolve(nextBiometricSuccess);
  });

  mod = (await import('../../src/profile/store')) as unknown as ProfileModuleSurface;
});

beforeEach(async () => {
  kv.clear();
  secureStore.clear();
  nextBiometricSuccess = true;
  biometricCalls.length = 0;
  mod.useProfileStore.setState({ record: null, jws: null, status: 'empty' });
  await rootKeyMod.deleteRootKey();
});

describe('saveProfile — signed, verifiable record', () => {
  it('constructs a valid signed record verifiable by verifyCompact, and persists it to MMKV', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Alice',
      bio: 'hello world',
      links: [{ label: 'Site', url: 'https://alice.example' }],
    });
    expect(result.ok).toBe(true);

    const state = mod.useProfileStore.getState();
    expect(state.status).toBe('ready');
    expect(state.record).not.toBeNull();
    expect(state.jws).not.toBeNull();
    if (!state.record || !state.jws) return;
    expect(state.record.v).toBe(1);
    expect(state.record.did).toBe(created.value.did);
    expect(state.record.displayName).toBe('Alice');
    expect(state.record.links).toEqual([{ label: 'Site', url: 'https://alice.example' }]);

    const verified = verifyCompact(state.jws, created.value.did);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.value).toEqual(state.record);

    const raw = kv.get('profile:v1');
    expect(raw).toBeDefined();
    if (!raw) return;
    const persisted = JSON.parse(raw) as { record: ProfileRecord; jws: string };
    expect(persisted.record.displayName).toBe('Alice');
    expect(persisted.jws).toBe(state.jws);
  });

  it('invalid fields (non-http link URL) return err before signing — no Face ID prompt, nothing persisted', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Bob',
      bio: '',
      links: [{ label: 'Bad', url: 'javascript:alert(1)' }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('links');
    expect(biometricCalls).toEqual([]);
    expect(mod.useProfileStore.getState().status).toBe('empty');
    expect(kv.has('profile:v1')).toBe(false);
  });

  it('returns err without a provisioned root key, and never prompts Face ID', async () => {
    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Nobody',
      bio: '',
      links: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('root identity');
    expect(biometricCalls).toEqual([]);
    expect(kv.has('profile:v1')).toBe(false);
  });

  it('propagates a Face ID denial as err(...) without corrupting stored state', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    nextBiometricSuccess = false;
    const result = await mod.useProfileStore.getState().saveProfile({
      displayName: 'Denied',
      bio: '',
      links: [],
    });
    expect(result.ok).toBe(false);
    expect(mod.useProfileStore.getState().status).toBe('empty');
    expect(kv.has('profile:v1')).toBe(false);
  });
});

describe('saveProfile — append-only replacement semantics', () => {
  it('updatedAt is strictly monotonic across successive saves', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await mod.useProfileStore.getState().saveProfile({ displayName: 'One', bio: '', links: [] });
    expect(first.ok).toBe(true);
    const firstRecord = mod.useProfileStore.getState().record;

    const second = await mod.useProfileStore.getState().saveProfile({ displayName: 'Two', bio: '', links: [] });
    expect(second.ok).toBe(true);
    const secondRecord = mod.useProfileStore.getState().record;

    expect(firstRecord).not.toBeNull();
    expect(secondRecord).not.toBeNull();
    if (!firstRecord || !secondRecord) return;

    expect(secondRecord).not.toBe(firstRecord); // fresh object — never mutated in place
    expect(secondRecord.displayName).toBe('Two');
    expect(secondRecord.did).toBe(firstRecord.did);
    expect(Date.parse(secondRecord.updatedAt)).toBeGreaterThan(Date.parse(firstRecord.updatedAt));
  });

  it('updatedAt still strictly advances when the system clock skews backward between saves', async () => {
    const created = await rootKeyMod.createFromFreshMnemonic();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    try {
      setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      const first = await mod.useProfileStore.getState().saveProfile({ displayName: 'One', bio: '', links: [] });
      expect(first.ok).toBe(true);
      const firstRecord = mod.useProfileStore.getState().record;
      expect(firstRecord).not.toBeNull();
      if (!firstRecord) return;
      const previousMs = Date.parse(firstRecord.updatedAt);

      // Backward clock skew (e.g. an NTP correction) before the next save —
      // Date.now() at save #2 is at or before the first record's updatedAt.
      setSystemTime(new Date('2025-12-31T23:59:00.000Z'));
      const second = await mod.useProfileStore.getState().saveProfile({ displayName: 'Two', bio: '', links: [] });
      expect(second.ok).toBe(true);
      const secondRecord = mod.useProfileStore.getState().record;
      expect(secondRecord).not.toBeNull();
      if (!secondRecord) return;

      const nextMs = Date.parse(secondRecord.updatedAt);
      expect(nextMs).toBeGreaterThan(previousMs);
      expect(nextMs).toBe(previousMs + 1);
    } finally {
      setSystemTime(); // restore the real clock for subsequent tests
    }
  });

  it('carries forward avatar/alsoKnownAs/badges/supersededBy as real empties across saves (never fabricated)', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'A', bio: '', links: [] });
    const r1 = mod.useProfileStore.getState().record;
    await mod.useProfileStore.getState().saveProfile({ displayName: 'B', bio: '', links: [] });
    const r2 = mod.useProfileStore.getState().record;

    expect(r1?.avatar).toBeNull();
    expect(r2?.avatar).toBeNull();
    expect(r2?.alsoKnownAs).toEqual([]);
    expect(r2?.badges).toEqual([]);
    expect(r2?.supersededBy).toBeNull();
  });
});

describe('hydrateProfile — MMKV round-trip', () => {
  it('restores record/jws/status after an in-memory reset (simulated app restart)', async () => {
    await rootKeyMod.createFromFreshMnemonic();
    await mod.useProfileStore.getState().saveProfile({ displayName: 'Carol', bio: 'hi', links: [] });
    const saved = mod.useProfileStore.getState();

    mod.useProfileStore.setState({ record: null, jws: null, status: 'empty' });
    expect(mod.useProfileStore.getState().status).toBe('empty');

    mod.hydrateProfile();
    const restored = mod.useProfileStore.getState();
    expect(restored.status).toBe('ready');
    expect(restored.record).toEqual(saved.record);
    expect(restored.jws).toBe(saved.jws);
  });

  it('leaves status empty when nothing has ever been saved', () => {
    mod.hydrateProfile();
    expect(mod.useProfileStore.getState().status).toBe('empty');
  });

  it('fails closed to empty on a corrupt persisted blob', () => {
    kv.set('profile:v1', '{not json');
    mod.hydrateProfile();
    expect(mod.useProfileStore.getState().status).toBe('empty');
  });

  it('fails closed to empty when the persisted record fails schema validation', () => {
    kv.set('profile:v1', JSON.stringify({ record: { v: 1, did: 'did:key:zBad' }, jws: 'a.b.c' }));
    mod.hydrateProfile();
    expect(mod.useProfileStore.getState().status).toBe('empty');
  });
});
