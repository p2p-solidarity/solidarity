/**
 * Sharing settings store — global / per-card / per-group `SharingPreferences`
 * overrides PLUS per-group `GroupSharingPolicy` policies, backed by MMKV.
 * Mirrors the persistence pattern in `apps/expo/src/settings/preferences.ts`:
 * in-memory `DEFAULTS` seed so the store is safe to subscribe to before
 * MMKV is ready, then `hydrateSharingSettings()` swaps in the persisted
 * state once `initMmkv()` resolves.
 *
 * Swift reference:
 *   solidarity/Services/Sharing/ShareSettingsStore.swift
 *     — uses UserDefaults for global per-field booleans. There is NO
 *       per-card override, per-group override, or per-group policy in
 *       Swift; this store extends the contract so the Expo client can
 *       offer richer redaction without a Swift port (per-group policy
 *       rules are documented in `defaults.ts` + `types.ts`).
 *
 * MMKV key namespace: `gg.solidarity.sharing.v1` — bumping the `v1`
 * suffix is a hard reset path if the JSON shape ever changes. New
 * `perGroupPolicies` field is read-tolerant on existing v1 blobs (absent
 * → `{}`), so the schema bump is non-breaking.
 */
import { create } from 'zustand';

import { getMmkv } from '@/storage/mmkv';
import type { GroupCredentialContext, SharingPreferences } from '@solidarity/shared';

import { defaultSharingPreferencesForLevel } from './defaults';
import { resolveCardForAudience } from './scopeResolver';
import type {
  AudienceTier,
  BusinessCard,
  GroupSharingPolicy,
  ResolvedCard,
} from './types';

const STORAGE_KEY = 'gg.solidarity.sharing.v1';

/**
 * Persisted shape. `SharingPreferences` field sets are `Set` instances in
 * memory but JSON serialises them as arrays — `serialize/deserialize`
 * handles the round-trip so the in-memory + on-disk shapes stay aligned.
 *
 * `perGroupPolicies` is optional on disk for backwards-compat with the
 * previous commit's v1 blob (absent → `{}`).
 */
interface PersistedShape {
  readonly globalDefaults: SerializedPrefs;
  readonly perCardOverrides: Readonly<Record<string, SerializedPrefs>>;
  readonly perGroupOverrides: Readonly<Record<string, SerializedPrefs>>;
  readonly perGroupPolicies?: Readonly<Record<string, SerializedPolicy>>;
}

interface SerializedPrefs {
  readonly publicFields: readonly string[];
  readonly professionalFields: readonly string[];
  readonly personalFields: readonly string[];
  readonly allowForwarding: boolean;
  readonly expirationDate?: string;
  readonly useZK: boolean;
  readonly sharingFormat: 'plaintext' | 'zkProof' | 'didSigned';
}

/**
 * Wire shape for `GroupSharingPolicy`. All fields optional — matches the
 * runtime type — so partial policies round-trip without padding.
 */
interface SerializedPolicy {
  readonly audienceCeiling?: AudienceTier;
  readonly fieldAllowlist?: readonly string[];
  readonly fieldDenylist?: readonly string[];
  readonly forceZk?: boolean;
  readonly disallowForwarding?: boolean;
  readonly displayReason?: string;
}

function serialize(p: SharingPreferences): SerializedPrefs {
  return {
    publicFields: Array.from(p.publicFields),
    professionalFields: Array.from(p.professionalFields),
    personalFields: Array.from(p.personalFields),
    allowForwarding: p.allowForwarding,
    expirationDate: p.expirationDate?.toISOString(),
    useZK: p.useZK,
    sharingFormat: p.sharingFormat,
  };
}

function deserialize(s: SerializedPrefs): SharingPreferences {
  return {
    publicFields: new Set(s.publicFields) as SharingPreferences['publicFields'],
    professionalFields: new Set(
      s.professionalFields
    ) as SharingPreferences['professionalFields'],
    personalFields: new Set(s.personalFields) as SharingPreferences['personalFields'],
    allowForwarding: s.allowForwarding,
    expirationDate: s.expirationDate ? new Date(s.expirationDate) : undefined,
    useZK: s.useZK,
    sharingFormat: s.sharingFormat,
  };
}

/**
 * Coerce a persisted SerializedPolicy back to the runtime
 * `GroupSharingPolicy`. Wire `string[]` field-list payloads become
 * `readonly FieldKey[]` — the FieldKey union is structural over the
 * BusinessCardField string literals, so no runtime validation is
 * needed beyond the trust we already place in our own MMKV blob.
 */
function serializePolicy(p: GroupSharingPolicy): SerializedPolicy {
  return {
    audienceCeiling: p.audienceCeiling,
    fieldAllowlist: p.fieldAllowlist ? Array.from(p.fieldAllowlist) : undefined,
    fieldDenylist: p.fieldDenylist ? Array.from(p.fieldDenylist) : undefined,
    forceZk: p.forceZk,
    disallowForwarding: p.disallowForwarding,
    displayReason: p.displayReason,
  };
}

function deserializePolicy(s: SerializedPolicy): GroupSharingPolicy {
  return {
    audienceCeiling: s.audienceCeiling,
    fieldAllowlist: s.fieldAllowlist as GroupSharingPolicy['fieldAllowlist'],
    fieldDenylist: s.fieldDenylist as GroupSharingPolicy['fieldDenylist'],
    forceZk: s.forceZk,
    disallowForwarding: s.disallowForwarding,
    displayReason: s.displayReason,
  };
}

const DEFAULT_GLOBAL = defaultSharingPreferencesForLevel('professional');

interface State {
  readonly globalDefaults: SharingPreferences;
  readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupPolicies: Readonly<Record<string, GroupSharingPolicy>>;
  readonly setGlobalDefaults: (prefs: SharingPreferences) => void;
  readonly setCardOverride: (cardId: string, prefs: SharingPreferences | null) => void;
  readonly setGroupOverride: (groupId: string, prefs: SharingPreferences | null) => void;
  /**
   * Set or clear the `GroupSharingPolicy` for a group. Pass `null` to
   * remove — the resolver will then fall back to the conservative
   * `defaultGroupSharingPolicy()` for any group-typed context belonging
   * to this group.
   */
  readonly setGroupPolicy: (
    groupId: string,
    policy: GroupSharingPolicy | null
  ) => void;
  /**
   * Synchronous policy lookup. Returns `null` when no explicit policy
   * has been set — callers needing the resolved effective policy should
   * instead call `resolveFor(...)` which applies the conservative
   * default for group-typed contexts.
   */
  readonly getGroupPolicy: (groupId: string) => GroupSharingPolicy | null;
  readonly resolveFor: (
    cardId: string,
    card: BusinessCard,
    audience: AudienceTier,
    groupContext?: GroupCredentialContext | null
  ) => ResolvedCard;
}

/**
 * Immutable record update — sets `key` to `value`, or removes it when
 * `value` is null. Avoids `delete` so we don't trip the
 * `@typescript-eslint/no-dynamic-delete` rule.
 */
function withMapEntry<V>(
  map: Readonly<Record<string, V>>,
  key: string,
  value: V | null
): Readonly<Record<string, V>> {
  if (value === null) {
    const next: Record<string, V> = {};
    for (const [k, v] of Object.entries(map)) {
      if (k !== key) next[k] = v;
    }
    return next;
  }
  return { ...map, [key]: value };
}

function readSafe(): PersistedShape | null {
  try {
    const raw = getMmkv().getString(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedShape;
  } catch {
    return null;
  }
}

function writeSafe(p: PersistedShape): void {
  try {
    getMmkv().set(STORAGE_KEY, JSON.stringify(p));
  } catch {
    // MMKV not ready / disk full — UI state stays correct; persistence
    // retries on the next mutation. Matches `preferences.ts`.
  }
}

function snapshotToPersisted(s: {
  readonly globalDefaults: SharingPreferences;
  readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupPolicies: Readonly<Record<string, GroupSharingPolicy>>;
}): PersistedShape {
  const cards: Record<string, SerializedPrefs> = {};
  for (const [k, v] of Object.entries(s.perCardOverrides)) cards[k] = serialize(v);
  const groups: Record<string, SerializedPrefs> = {};
  for (const [k, v] of Object.entries(s.perGroupOverrides)) groups[k] = serialize(v);
  const policies: Record<string, SerializedPolicy> = {};
  for (const [k, v] of Object.entries(s.perGroupPolicies)) policies[k] = serializePolicy(v);
  return {
    globalDefaults: serialize(s.globalDefaults),
    perCardOverrides: cards,
    perGroupOverrides: groups,
    perGroupPolicies: policies,
  };
}

function persistedToState(p: PersistedShape): {
  readonly globalDefaults: SharingPreferences;
  readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupPolicies: Readonly<Record<string, GroupSharingPolicy>>;
} {
  const cards: Record<string, SharingPreferences> = {};
  for (const [k, v] of Object.entries(p.perCardOverrides)) cards[k] = deserialize(v);
  const groups: Record<string, SharingPreferences> = {};
  for (const [k, v] of Object.entries(p.perGroupOverrides)) groups[k] = deserialize(v);
  const policies: Record<string, GroupSharingPolicy> = {};
  for (const [k, v] of Object.entries(p.perGroupPolicies ?? {})) {
    policies[k] = deserializePolicy(v);
  }
  return {
    globalDefaults: deserialize(p.globalDefaults),
    perCardOverrides: cards,
    perGroupOverrides: groups,
    perGroupPolicies: policies,
  };
}

export const useSharingSettings = create<State>((set, get) => ({
  globalDefaults: DEFAULT_GLOBAL,
  perCardOverrides: {},
  perGroupOverrides: {},
  perGroupPolicies: {},

  setGlobalDefaults: (prefs) => {
    set((s) => {
      const next = { ...s, globalDefaults: prefs };
      writeSafe(snapshotToPersisted(next));
      return { globalDefaults: prefs };
    });
  },

  setCardOverride: (cardId, prefs) => {
    set((s) => {
      const nextMap = withMapEntry(s.perCardOverrides, cardId, prefs);
      const next = { ...s, perCardOverrides: nextMap };
      writeSafe(snapshotToPersisted(next));
      return { perCardOverrides: nextMap };
    });
  },

  setGroupOverride: (groupId, prefs) => {
    set((s) => {
      const nextMap = withMapEntry(s.perGroupOverrides, groupId, prefs);
      const next = { ...s, perGroupOverrides: nextMap };
      writeSafe(snapshotToPersisted(next));
      return { perGroupOverrides: nextMap };
    });
  },

  setGroupPolicy: (groupId, policy) => {
    set((s) => {
      const nextMap = withMapEntry(s.perGroupPolicies, groupId, policy);
      const next = { ...s, perGroupPolicies: nextMap };
      writeSafe(snapshotToPersisted(next));
      return { perGroupPolicies: nextMap };
    });
  },

  getGroupPolicy: (groupId) => {
    return get().perGroupPolicies[groupId] ?? null;
  },

  resolveFor: (cardId, card, audience, groupContext) => {
    const s = get();
    // Pick the per-group policy by the group bound to this exchange
    // (groupContext.info.groupId). When no explicit policy is set the
    // resolver applies the conservative default for any group-typed
    // context — see `defaultGroupSharingPolicy()`.
    const groupId =
      groupContext?.type === 'group' ? groupContext.info.groupId : null;
    const explicitPolicy = groupId ? s.perGroupPolicies[groupId] : undefined;
    return resolveCardForAudience({
      card,
      audience,
      perCardPrefs: s.perCardOverrides[cardId],
      groupContext,
      globalDefaults: s.globalDefaults,
      groupPolicy: explicitPolicy,
    });
  },
}));

/**
 * Hydrate the in-memory store from MMKV. Call once from the root layout
 * after `initMmkv()` resolves. Mirrors `hydratePreferences()` in
 * `settings/preferences.ts`.
 */
export function hydrateSharingSettings(): void {
  const persisted = readSafe();
  if (!persisted) return;
  useSharingSettings.setState(persistedToState(persisted));
}

/** Test helper — reset the in-memory store to defaults without touching MMKV. */
export function _resetSharingSettingsForTest(): void {
  useSharingSettings.setState({
    globalDefaults: DEFAULT_GLOBAL,
    perCardOverrides: {},
    perGroupOverrides: {},
    perGroupPolicies: {},
  });
}
