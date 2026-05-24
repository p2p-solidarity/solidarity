/**
 * `useSharingSettings` — MMKV persistence + zustand state contract.
 *
 * Mirrors the test pattern in groupStore.test.ts: mock `@/storage/mmkv`
 * with an in-memory map so the store's reads/writes are observable
 * without touching native code.
 *
 * Anchors:
 *   - Hydrating from an empty MMKV does NOT throw and leaves the in-memory
 *     defaults intact.
 *   - `setGlobalDefaults(...)` writes to MMKV under
 *     `gg.solidarity.sharing.v1`.
 *   - A round-trip (write → reset zustand → hydrate) restores the same
 *     SharingPreferences shape (Sets, not arrays).
 *   - `setCardOverride(id, null)` removes the entry from MMKV.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { SharingPreferences } from '@solidarity/shared';

interface StoreSurface {
  readonly useSharingSettings: {
    getState: () => {
      readonly globalDefaults: SharingPreferences;
      readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly setGlobalDefaults: (p: SharingPreferences) => void;
      readonly setCardOverride: (id: string, p: SharingPreferences | null) => void;
      readonly setGroupOverride: (id: string, p: SharingPreferences | null) => void;
    };
    setState: (s: Partial<{
      readonly globalDefaults: SharingPreferences;
      readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
    }>) => void;
  };
  readonly hydrateSharingSettings: () => void;
  readonly _resetSharingSettingsForTest: () => void;
}

interface DefaultsSurface {
  readonly defaultSharingPreferencesForLevel: (
    l: 'public' | 'professional' | 'personal'
  ) => SharingPreferences;
}

const STORAGE_KEY = 'gg.solidarity.sharing.v1';
const kv = new Map<string, string>();
let mod: StoreSurface;
let defaultsMod: DefaultsSurface;

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
    initMmkv: async () => undefined,
  }));
  mod = await import('../../src/sharing/settingsStore');
  defaultsMod = await import('../../src/sharing/defaults');
});

beforeEach(() => {
  kv.clear();
  mod._resetSharingSettingsForTest();
});

function makePrefs(): SharingPreferences {
  return {
    publicFields: new Set([
      'name',
      'title',
    ]),
    professionalFields: new Set([
      'name',
      'email',
      'company',
    ]),
    personalFields: new Set([
      'name',
      'email',
      'phone',
    ]),
    allowForwarding: true,
    expirationDate: undefined,
    useZK: true,
    sharingFormat: 'didSigned',
  };
}

describe('hydrateSharingSettings: empty MMKV', () => {
  it('does NOT throw when the storage key is absent', () => {
    expect(() => {
      mod.hydrateSharingSettings();
    }).not.toThrow();
  });

  it('leaves the in-memory defaults intact when nothing is persisted', () => {
    mod.hydrateSharingSettings();
    const def = defaultsMod.defaultSharingPreferencesForLevel('professional');
    const state = mod.useSharingSettings.getState();
    expect(Array.from(state.globalDefaults.publicFields).sort()).toEqual(
      Array.from(def.publicFields).sort()
    );
    expect(Object.keys(state.perCardOverrides)).toEqual([]);
    expect(Object.keys(state.perGroupOverrides)).toEqual([]);
  });
});

describe('persistence: setGlobalDefaults survives a store reset + hydrate', () => {
  it('writes under the gg.solidarity.sharing.v1 key', () => {
    const prefs = makePrefs();
    mod.useSharingSettings.getState().setGlobalDefaults(prefs);
    expect(kv.has(STORAGE_KEY)).toBe(true);
  });

  it('a reset + hydrate restores the same Set-shaped prefs', () => {
    const prefs = makePrefs();
    mod.useSharingSettings.getState().setGlobalDefaults(prefs);

    // Simulate fresh process boot: wipe in-memory state, re-hydrate from KV.
    mod._resetSharingSettingsForTest();
    expect(
      Array.from(mod.useSharingSettings.getState().globalDefaults.publicFields).sort()
    ).not.toEqual(['name', 'title']);

    mod.hydrateSharingSettings();
    const restored = mod.useSharingSettings.getState().globalDefaults;
    expect(restored.publicFields instanceof Set).toBe(true);
    expect(Array.from(restored.publicFields).sort()).toEqual(['name', 'title']);
    expect(Array.from(restored.professionalFields).sort()).toEqual([
      'company',
      'email',
      'name',
    ]);
    expect(restored.allowForwarding).toBe(true);
    expect(restored.sharingFormat).toBe('didSigned');
  });
});

describe('per-card / per-group override persistence', () => {
  it('setCardOverride writes the entry; null removes it', () => {
    const prefs = makePrefs();
    mod.useSharingSettings.getState().setCardOverride('card-1', prefs);
    let state = mod.useSharingSettings.getState();
    expect(Object.keys(state.perCardOverrides)).toContain('card-1');

    // Round-trip through MMKV: the persisted blob should contain card-1.
    const raw = kv.get(STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(raw).toContain('card-1');

    // Now remove it.
    mod.useSharingSettings.getState().setCardOverride('card-1', null);
    state = mod.useSharingSettings.getState();
    expect(Object.keys(state.perCardOverrides)).not.toContain('card-1');
    const rawAfter = kv.get(STORAGE_KEY);
    expect(rawAfter).toBeDefined();
    expect(rawAfter).not.toContain('card-1');
  });

  it('setGroupOverride persists across a hydrate cycle', () => {
    const prefs = makePrefs();
    mod.useSharingSettings.getState().setGroupOverride('group-A', prefs);

    mod._resetSharingSettingsForTest();
    expect(Object.keys(mod.useSharingSettings.getState().perGroupOverrides)).toEqual([]);

    mod.hydrateSharingSettings();
    const restored = mod.useSharingSettings.getState().perGroupOverrides['group-A'];
    expect(restored).toBeDefined();
    if (!restored) throw new Error('unreachable: restored is defined');
    expect(Array.from(restored.personalFields).sort()).toEqual(['email', 'name', 'phone']);
  });
});
