/**
 * `ShareScopeResolver` — covers the audience-tier filter, per-card override,
 * and group-context overlay rules.
 *
 * Swift reference:
 *   solidarity/Models/BusinessCard.swift::filteredCard(for:)
 *     — defines the strip behaviour (string → nil, array → []).
 *   solidarity/Models/BusinessCard.swift::SharingPreferences.init(...)
 *     — defines the default field sets we exercise here.
 *
 * Anchors:
 *   - `.name` is always retained (Swift inserts it into every set).
 *   - public default = name + title + company.
 *   - professional default = name + title + company + email + skills.
 *   - personal default = all 8 fields.
 *   - Per-card override fully replaces the global field set.
 *   - Group context tightens (intersection) — never grants new fields.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type {
  BusinessCard,
  GroupCredentialContext,
  SharingPreferences,
} from '@solidarity/shared';

import type { GroupSharingPolicy } from '../../src/sharing/types';

interface ResolvedCardLite {
  readonly card: BusinessCard;
  readonly includedFields: readonly string[];
  readonly excludedFields: readonly string[];
  readonly appliedPolicy?: {
    readonly source: 'group' | 'card' | 'default';
    readonly reason?: string;
  };
}

interface ResolverSurface {
  readonly resolveCardForAudience: (args: {
    readonly card: BusinessCard;
    readonly audience: 'public' | 'professional' | 'personal';
    readonly perCardPrefs?: SharingPreferences;
    readonly groupContext?: GroupCredentialContext | null;
    readonly globalDefaults?: SharingPreferences;
    readonly groupPolicy?: GroupSharingPolicy | null;
  }) => ResolvedCardLite;
  readonly resolveEffectiveFlags: (args: {
    readonly card: BusinessCard;
    readonly audience: 'public' | 'professional' | 'personal';
    readonly perCardPrefs?: SharingPreferences;
    readonly groupContext?: GroupCredentialContext | null;
    readonly globalDefaults?: SharingPreferences;
    readonly groupPolicy?: GroupSharingPolicy | null;
  }) => { readonly useZK: boolean; readonly allowForwarding: boolean };
  readonly defaultSharingPreferencesForLevel: (
    l: 'public' | 'professional' | 'personal'
  ) => SharingPreferences;
  readonly defaultGroupSharingPolicy: () => GroupSharingPolicy;
}

interface StoreSurface {
  readonly useSharingSettings: {
    getState: () => {
      readonly setCardOverride: (id: string, prefs: SharingPreferences | null) => void;
      readonly setGroupPolicy: (
        groupId: string,
        policy: GroupSharingPolicy | null
      ) => void;
      readonly getGroupPolicy: (groupId: string) => GroupSharingPolicy | null;
      readonly resolveFor: (
        cardId: string,
        card: BusinessCard,
        audience: 'public' | 'professional' | 'personal',
        groupContext?: GroupCredentialContext | null
      ) => ResolvedCardLite;
    };
    setState: (s: Partial<{
      readonly globalDefaults: SharingPreferences;
      readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
      readonly perGroupPolicies: Readonly<Record<string, GroupSharingPolicy>>;
    }>) => void;
  };
  readonly _resetSharingSettingsForTest: () => void;
}

let mod: ResolverSurface;
let storeMod: StoreSurface;

const kv = new Map<string, string>();

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
  mod = await import('../../src/sharing');
  storeMod = await import('../../src/sharing/settingsStore');
});

beforeEach(() => {
  kv.clear();
  storeMod._resetSharingSettingsForTest();
});

function makeCard(overrides: Partial<BusinessCard> = {}): BusinessCard {
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
    sharingPreferences: mod.defaultSharingPreferencesForLevel('professional'),
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('resolveCardForAudience — default per-level field sets', () => {
  it('public tier with defaults keeps name + title + company; strips email/phone/skills', () => {
    const card = makeCard();
    const r = mod.resolveCardForAudience({ card, audience: 'public' });
    expect(r.card.name).toBe('Alice Doe');
    expect(r.card.title).toBe('Engineer');
    expect(r.card.company).toBe('Acme');
    expect(r.card.email).toBeUndefined();
    expect(r.card.phone).toBeUndefined();
    expect(r.card.skills).toEqual([]);
    expect([...r.includedFields].sort()).toEqual(['company', 'name', 'title']);
    expect(r.excludedFields).toContain('email');
    expect(r.excludedFields).toContain('phone');
  });

  it('professional tier keeps name + title + company + email + skills; strips phone', () => {
    const card = makeCard();
    const r = mod.resolveCardForAudience({ card, audience: 'professional' });
    expect(r.card.email).toBe('alice@acme.com');
    expect(r.card.title).toBe('Engineer');
    expect(r.card.company).toBe('Acme');
    expect(r.card.phone).toBeUndefined();
    expect(r.includedFields).toContain('email');
    expect(r.excludedFields).toContain('phone');
  });

  it('personal tier keeps every populated field', () => {
    const card = makeCard();
    const r = mod.resolveCardForAudience({ card, audience: 'personal' });
    expect(r.card.email).toBe('alice@acme.com');
    expect(r.card.phone).toBe('+15555550100');
    expect(r.excludedFields).toEqual([]);
  });

  it('name is always retained even when an explicit pref omits it', () => {
    // Construct a hostile pref set that does not include `name`. The
    // overlay/intersection layer must still emit `.name` as mandatory
    // (matches Swift SharingPreferences.init line 274-279).
    const aggressive: SharingPreferences = {
      publicFields: new Set([]),
      professionalFields: new Set([]),
      personalFields: new Set([]),
      allowForwarding: false,
      expirationDate: undefined,
      useZK: true,
      sharingFormat: 'didSigned',
    };
    const card = makeCard();
    const r = mod.resolveCardForAudience({
      card,
      audience: 'public',
      perCardPrefs: aggressive,
    });
    expect(r.includedFields).toContain('name');
    expect(r.card.name).toBe('Alice Doe');
  });
});

describe('resolveCardForAudience — per-card override beats global default', () => {
  it('per-card override may TIGHTEN the global default', () => {
    const card = makeCard();
    // Per-card: only name + email at professional tier.
    const tightOverride: SharingPreferences = {
      publicFields: new Set(['name']),
      professionalFields: new Set([
        'name',
        'email',
      ]),
      personalFields: new Set([
        'name',
        'email',
      ]),
      allowForwarding: false,
      expirationDate: undefined,
      useZK: true,
      sharingFormat: 'didSigned',
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'professional',
      perCardPrefs: tightOverride,
    });
    expect(r.card.title).toBeUndefined();
    expect(r.card.company).toBeUndefined();
    expect(r.card.email).toBe('alice@acme.com');
    expect([...r.includedFields].sort()).toEqual(['email', 'name']);
  });

  it('per-card override may EXPAND past the global default', () => {
    const card = makeCard();
    // Global default: public = [name, title, company]. Per-card grants
    // email + skills at the public tier too.
    const looserOverride: SharingPreferences = {
      publicFields: new Set([
        'name',
        'title',
        'company',
        'email',
        'skills',
      ]),
      professionalFields: new Set([
        'name',
        'title',
        'company',
        'email',
        'skills',
      ]),
      personalFields: new Set([
        'name',
        'title',
        'company',
        'email',
        'skills',
      ]),
      allowForwarding: false,
      expirationDate: undefined,
      useZK: true,
      sharingFormat: 'didSigned',
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'public',
      perCardPrefs: looserOverride,
    });
    expect(r.card.email).toBe('alice@acme.com');
    expect(r.includedFields).toContain('email');
  });
});

describe('resolveCardForAudience — group-context overlay', () => {
  it('personal group-context type does NOT restrict', () => {
    const card = makeCard();
    const groupContext: GroupCredentialContext = { type: 'personal' };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
    });
    expect(r.card.phone).toBe('+15555550100');
  });

  it('group-typed context tightens — `phone` is dropped at every tier', () => {
    const card = makeCard();
    const groupContext: GroupCredentialContext = {
      type: 'group',
      info: {
        groupId: 'g-1',
        groupName: 'Aurora',
        merkleRoot: 'deadbeef',
        issuedBy: 'did:key:zXYZ',
        issuedAt: new Date('2025-01-01'),
        proofRequired: false,
      },
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
    });
    expect(r.card.phone).toBeUndefined();
    expect(r.includedFields).not.toContain('phone');
    expect(r.excludedFields).toContain('phone');
  });

  it('group overlay can only tighten, never grant — empty per-card stays empty', () => {
    // Per-card prefs hide email; group overlay does NOT bring email back.
    const card = makeCard();
    const tightOverride: SharingPreferences = {
      publicFields: new Set(['name']),
      professionalFields: new Set(['name']),
      personalFields: new Set(['name']),
      allowForwarding: false,
      expirationDate: undefined,
      useZK: true,
      sharingFormat: 'didSigned',
    };
    const groupContext: GroupCredentialContext = {
      type: 'group',
      info: {
        groupId: 'g-1',
        groupName: 'Aurora',
        merkleRoot: 'deadbeef',
        issuedBy: 'did:key:zXYZ',
        issuedAt: new Date('2025-01-01'),
        proofRequired: false,
      },
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      perCardPrefs: tightOverride,
      groupContext,
    });
    expect(r.includedFields).toEqual(['name']);
    expect(r.card.email).toBeUndefined();
  });
});

describe('useSharingSettings.resolveFor — round trip via the store', () => {
  it('setCardOverride is honoured by a subsequent resolveFor', () => {
    const card = makeCard();
    const tightOverride: SharingPreferences = {
      publicFields: new Set(['name']),
      professionalFields: new Set([
        'name',
        'email',
      ]),
      personalFields: new Set([
        'name',
        'email',
      ]),
      allowForwarding: false,
      expirationDate: undefined,
      useZK: true,
      sharingFormat: 'didSigned',
    };
    storeMod.useSharingSettings.getState().setCardOverride(card.id, tightOverride);
    const r = storeMod.useSharingSettings
      .getState()
      .resolveFor(card.id, card, 'professional');
    expect([...r.includedFields].sort()).toEqual(['email', 'name']);
    expect(r.card.title).toBeUndefined();
  });

  it('no per-card override → resolveFor falls back to the global default', () => {
    const card = makeCard();
    const r = storeMod.useSharingSettings
      .getState()
      .resolveFor(card.id, card, 'public');
    expect([...r.includedFields].sort()).toEqual(['company', 'name', 'title']);
  });
});

/**
 * GroupSharingPolicy — the richer per-group overlay layered on TOP of the
 * base SharingPreferences chain. The conservative default (`fieldDenylist:
 * ['phone']`) preserves the d7a5787 behaviour; the new knobs (ceiling,
 * allowlist, forceZk, disallowForwarding) go beyond Swift's global-only
 * model. Each test pins one knob in isolation so a regression points to
 * the exact field that broke.
 */
describe('resolveCardForAudience — GroupSharingPolicy overlay', () => {
  const groupContext: GroupCredentialContext = {
    type: 'group',
    info: {
      groupId: 'g-1',
      groupName: 'Aurora',
      merkleRoot: 'deadbeef',
      issuedBy: 'did:key:zXYZ',
      issuedAt: new Date('2025-01-01'),
      proofRequired: false,
    },
  };

  it('default policy (no explicit policy + group context) still drops phone', () => {
    // Backwards-compat anchor for d7a5787 — the conservative phone-drop
    // is now expressed as `defaultGroupSharingPolicy()` and applied by
    // the resolver whenever a group-typed context is present.
    const card = makeCard();
    const r = mod.resolveCardForAudience({ card, audience: 'personal', groupContext });
    expect(r.card.phone).toBeUndefined();
    expect(r.excludedFields).toContain('phone');
    expect(r.appliedPolicy?.source).toBe('default');
    expect(r.appliedPolicy?.reason).toBe('Conservative group default');
  });

  it('audienceCeiling: "professional" caps a personal-tier resolve down', () => {
    // Card prefs at personal include all 8 fields. Policy ceiling clamps
    // the requested tier to professional, so the effective field set
    // matches the professional default (no phone, no profileImage, no
    // socialNetworks).
    const card = makeCard();
    const policy: GroupSharingPolicy = {
      audienceCeiling: 'professional',
      // No denylist: prove the ceiling alone does the work.
      fieldDenylist: [],
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
      groupPolicy: policy,
    });
    // Professional default = name + title + company + email + skills.
    expect([...r.includedFields].sort()).toEqual([
      'company',
      'email',
      'name',
      'skills',
      'title',
    ]);
    expect(r.card.phone).toBeUndefined();
    expect(r.card.email).toBe('alice@acme.com');
    expect(r.appliedPolicy?.source).toBe('group');
  });

  it('fieldDenylist: ["email"] strips email even when card pref allows', () => {
    // Card pref at personal would grant email; denylist subtracts it.
    const card = makeCard();
    const policy: GroupSharingPolicy = {
      fieldDenylist: ['email'],
      displayReason: 'No email in this group',
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
      groupPolicy: policy,
    });
    expect(r.card.email).toBeUndefined();
    expect(r.includedFields).not.toContain('email');
    expect(r.excludedFields).toContain('email');
    expect(r.appliedPolicy?.reason).toBe('No email in this group');
  });

  it('fieldAllowlist: ["name", "company"] keeps ONLY those two', () => {
    const card = makeCard();
    const policy: GroupSharingPolicy = {
      // `animal` is in the type union but `name` is mandatory — verify
      // the allowlist intersection retains `name` regardless of input.
      fieldAllowlist: ['name', 'company'],
      // Empty denylist so this is a pure allowlist test.
      fieldDenylist: [],
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
      groupPolicy: policy,
    });
    expect([...r.includedFields].sort()).toEqual(['company', 'name']);
    expect(r.card.email).toBeUndefined();
    expect(r.card.title).toBeUndefined();
    expect(r.card.phone).toBeUndefined();
  });

  it('forceZk: true flips useZK = true even if base was false', () => {
    const card = makeCard();
    const baseOff: SharingPreferences = {
      ...mod.defaultSharingPreferencesForLevel('professional'),
      useZK: false,
    };
    const policy: GroupSharingPolicy = { forceZk: true, fieldDenylist: [] };

    const flags = mod.resolveEffectiveFlags({
      card,
      audience: 'professional',
      perCardPrefs: baseOff,
      groupContext,
      groupPolicy: policy,
    });
    expect(flags.useZK).toBe(true);

    // Verify the policy also surfaces on the resolved card (forceZk hit
    // counts as a policy hit even if no fields changed).
    const r = mod.resolveCardForAudience({
      card,
      audience: 'professional',
      perCardPrefs: baseOff,
      groupContext,
      groupPolicy: policy,
    });
    expect(r.appliedPolicy?.source).toBe('group');
  });

  it('disallowForwarding: true flips allowForwarding = false', () => {
    const card = makeCard();
    const baseOn: SharingPreferences = {
      ...mod.defaultSharingPreferencesForLevel('professional'),
      allowForwarding: true,
    };
    const policy: GroupSharingPolicy = {
      disallowForwarding: true,
      fieldDenylist: [],
    };

    const flags = mod.resolveEffectiveFlags({
      card,
      audience: 'professional',
      perCardPrefs: baseOn,
      groupContext,
      groupPolicy: policy,
    });
    expect(flags.allowForwarding).toBe(false);

    const r = mod.resolveCardForAudience({
      card,
      audience: 'professional',
      perCardPrefs: baseOn,
      groupContext,
      groupPolicy: policy,
    });
    expect(r.appliedPolicy?.source).toBe('group');
  });

  it('combined policy: all four restrictions stack additively', () => {
    const card = makeCard();
    const baseLoose: SharingPreferences = {
      ...mod.defaultSharingPreferencesForLevel('personal'),
      allowForwarding: true,
      useZK: false,
    };
    const policy: GroupSharingPolicy = {
      audienceCeiling: 'professional',
      fieldAllowlist: ['name', 'company', 'email', 'skills', 'title'],
      fieldDenylist: ['email'],
      forceZk: true,
      disallowForwarding: true,
      displayReason: 'Co-workers — strict',
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      perCardPrefs: baseLoose,
      groupContext,
      groupPolicy: policy,
    });
    // Ceiling clamps to professional; allowlist intersects to those 5
    // fields; denylist removes email — leaves name, title, company, skills.
    expect([...r.includedFields].sort()).toEqual([
      'company',
      'name',
      'skills',
      'title',
    ]);
    const flags = mod.resolveEffectiveFlags({
      card,
      audience: 'personal',
      perCardPrefs: baseLoose,
      groupContext,
      groupPolicy: policy,
    });
    expect(flags.useZK).toBe(true);
    expect(flags.allowForwarding).toBe(false);
    expect(r.appliedPolicy?.source).toBe('group');
    expect(r.appliedPolicy?.reason).toBe('Co-workers — strict');
  });

  it('appliedPolicy.reason is surfaced in ResolvedCard when policy hits', () => {
    const card = makeCard();
    const policy: GroupSharingPolicy = {
      fieldDenylist: ['email'],
      displayReason: 'Banner copy',
    };
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
      groupPolicy: policy,
    });
    expect(r.appliedPolicy?.reason).toBe('Banner copy');
  });

  it('explicit null policy opts out of the conservative default', () => {
    // Passing groupPolicy: null disables BOTH the explicit and default
    // policies, even when a group-typed context is present. Phone is
    // still dropped by the legacy `defaultPreferencesForGroupContext`
    // overlay (that is part of the base chain, not the policy layer),
    // so this test asserts the policy-only surface stays clean.
    const card = makeCard();
    const r = mod.resolveCardForAudience({
      card,
      audience: 'personal',
      groupContext,
      groupPolicy: null,
    });
    expect(r.appliedPolicy).toBeUndefined();
  });

  it('store-level resolveFor picks up the registered per-group policy', () => {
    const card = makeCard();
    storeMod.useSharingSettings.getState().setGroupPolicy('g-1', {
      audienceCeiling: 'professional',
      fieldDenylist: ['email'],
      displayReason: 'Store-registered policy',
    });
    const r = storeMod.useSharingSettings
      .getState()
      .resolveFor(card.id, card, 'personal', groupContext);
    expect(r.card.email).toBeUndefined();
    expect(r.appliedPolicy?.reason).toBe('Store-registered policy');
    // Ceiling clamps to professional, denylist removes email → name +
    // title + company + skills.
    expect([...r.includedFields].sort()).toEqual([
      'company',
      'name',
      'skills',
      'title',
    ]);
  });
});
