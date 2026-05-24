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

import type {
  BusinessCard,
  GroupCredentialContext,
  SharingPreferences,
} from '@solidarity/shared';

import type { GroupSharingPolicy, ResolvedCard } from '../../src/sharing/types';

interface StoreSurface {
  readonly useSharingSettings: {
    getState: () => {
      readonly globalDefaults: SharingPreferences;
      readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupPolicies: Readonly<Record<string, GroupSharingPolicy>>;
      readonly setGlobalDefaults: (p: SharingPreferences) => void;
      readonly setCardOverride: (id: string, p: SharingPreferences | null) => void;
      readonly setGroupOverride: (id: string, p: SharingPreferences | null) => void;
      readonly setGroupPolicy: (
        id: string,
        p: GroupSharingPolicy | null
      ) => void;
      readonly getGroupPolicy: (id: string) => GroupSharingPolicy | null;
      readonly resolveFor: (
        cardId: string,
        card: BusinessCard,
        audience: 'public' | 'professional' | 'personal',
        groupContext?: GroupCredentialContext | null
      ) => ResolvedCard;
    };
    setState: (s: Partial<{
      readonly globalDefaults: SharingPreferences;
      readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupPolicies: Readonly<Record<string, GroupSharingPolicy>>;
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

/**
 * `perGroupPolicies` — the GroupSharingPolicy registry the resolver
 * consults whenever a group-typed context names a registered group.
 * Persistence shape change is backwards-compat: existing v1 blobs without
 * `perGroupPolicies` hydrate to `{}` (verified by the older store tests
 * still passing in this file).
 */
describe('GroupSharingPolicy registry: setGroupPolicy + getGroupPolicy', () => {
  function makePolicy(): GroupSharingPolicy {
    return {
      audienceCeiling: 'professional',
      fieldAllowlist: ['name', 'title', 'company', 'email'],
      fieldDenylist: ['phone'],
      forceZk: true,
      disallowForwarding: true,
      displayReason: 'Strict co-workers policy',
    };
  }

  it('setGroupPolicy stores the entry; getGroupPolicy returns it', () => {
    const policy = makePolicy();
    mod.useSharingSettings.getState().setGroupPolicy('group-A', policy);

    const got = mod.useSharingSettings.getState().getGroupPolicy('group-A');
    expect(got).toEqual(policy);
    expect(mod.useSharingSettings.getState().getGroupPolicy('unknown-group')).toBeNull();
  });

  it('setGroupPolicy(null) removes the entry', () => {
    const policy = makePolicy();
    mod.useSharingSettings.getState().setGroupPolicy('group-A', policy);
    mod.useSharingSettings.getState().setGroupPolicy('group-A', null);
    expect(mod.useSharingSettings.getState().getGroupPolicy('group-A')).toBeNull();
    expect(
      Object.keys(mod.useSharingSettings.getState().perGroupPolicies)
    ).not.toContain('group-A');
  });

  it('setGroupPolicy persists across a hydrate cycle (reset → hydrate)', () => {
    const policy = makePolicy();
    mod.useSharingSettings.getState().setGroupPolicy('group-A', policy);

    // Verify it was actually written to the v1 blob.
    const raw = kv.get(STORAGE_KEY);
    expect(raw).toBeDefined();
    expect(raw).toContain('group-A');
    expect(raw).toContain('Strict co-workers policy');

    // Fresh-process simulation.
    mod._resetSharingSettingsForTest();
    expect(
      Object.keys(mod.useSharingSettings.getState().perGroupPolicies)
    ).toEqual([]);

    mod.hydrateSharingSettings();
    const restored = mod.useSharingSettings.getState().getGroupPolicy('group-A');
    expect(restored).toEqual(policy);
  });
});

describe('resolveFor — picks up the policy AND the override together', () => {
  const groupContext: GroupCredentialContext = {
    type: 'group',
    info: {
      groupId: 'group-A',
      groupName: 'Aurora',
      merkleRoot: 'deadbeef',
      issuedBy: 'did:key:zXYZ',
      issuedAt: new Date('2025-01-01'),
      proofRequired: false,
    },
  };

  function makeCard(): BusinessCard {
    return {
      id: '11111111-2222-3333-4444-555555555555',
      name: 'Alice Doe',
      title: 'Engineer',
      company: 'Acme',
      email: 'alice@acme.com',
      phone: '+15555550100',
      profileImage: undefined,
      animal: undefined,
      socialNetworks: [],
      skills: [],
      categories: [],
      sharingPreferences: defaultsMod.defaultSharingPreferencesForLevel('professional'),
      groupContext: undefined,
      verifiedFields: undefined,
      nameType: 'display_name',
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    };
  }

  it('per-card override tightens; per-group policy further restricts; both annotated', () => {
    const card = makeCard();
    // Per-card: permit name + email + skills at every tier.
    const cardOverride: SharingPreferences = {
      publicFields: new Set(['name', 'email', 'skills']),
      professionalFields: new Set(['name', 'email', 'skills']),
      personalFields: new Set(['name', 'email', 'skills']),
      allowForwarding: true,
      expirationDate: undefined,
      useZK: false,
      sharingFormat: 'didSigned',
    };
    // Policy: denylist email, force ZK on. Combined → name + skills only.
    const policy: GroupSharingPolicy = {
      fieldDenylist: ['email'],
      forceZk: true,
      displayReason: 'Group strips email',
    };

    mod.useSharingSettings.getState().setCardOverride(card.id, cardOverride);
    mod.useSharingSettings.getState().setGroupPolicy('group-A', policy);

    const r = mod.useSharingSettings
      .getState()
      .resolveFor(card.id, card, 'personal', groupContext);

    expect([...r.includedFields].sort()).toEqual(['name', 'skills']);
    expect(r.card.email).toBeUndefined();
    expect(r.card.phone).toBeUndefined();
    expect(r.appliedPolicy?.source).toBe('group');
    expect(r.appliedPolicy?.reason).toBe('Group strips email');
  });

  it('no per-group policy registered → resolveFor falls back to the conservative default', () => {
    const card = makeCard();
    const r = mod.useSharingSettings
      .getState()
      .resolveFor(card.id, card, 'personal', groupContext);
    // Conservative default = phone-only denylist.
    expect(r.card.phone).toBeUndefined();
    expect(r.appliedPolicy?.source).toBe('default');
    expect(r.appliedPolicy?.reason).toBe('Conservative group default');
  });
});
