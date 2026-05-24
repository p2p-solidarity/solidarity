/**
 * Sharing settings store — global / per-card / per-group `SharingPreferences`
 * overrides backed by MMKV. Mirrors the persistence pattern in
 * `apps/expo/src/settings/preferences.ts`: in-memory `DEFAULTS` seed so the
 * store is safe to subscribe to before MMKV is ready, then `hydrateSharingSettings()`
 * swaps in the persisted state once `initMmkv()` resolves.
 *
 * Swift reference:
 *   solidarity/Services/Sharing/ShareSettingsStore.swift
 *     — uses UserDefaults for global per-field booleans. There is NO
 *       per-card or per-group override surface in Swift; this store
 *       extends the contract so the Expo client can offer richer
 *       redaction without a Swift port (group context overlay rules
 *       are documented in `defaults.ts`).
 *
 * MMKV key namespace: `gg.solidarity.sharing.v1` — bumping the `v1`
 * suffix is a hard reset path if the JSON shape ever changes.
 */
import { create } from 'zustand';

import { getMmkv } from '@/storage/mmkv';
import type { GroupCredentialContext, SharingPreferences } from '@solidarity/shared';

import { defaultSharingPreferencesForLevel } from './defaults';
import { resolveCardForAudience } from './scopeResolver';
import type { AudienceTier, BusinessCard, ResolvedCard } from './types';

const STORAGE_KEY = 'gg.solidarity.sharing.v1';

/**
 * Persisted shape. `SharingPreferences` field sets are `Set` instances in
 * memory but JSON serialises them as arrays — `serialize/deserialize`
 * handles the round-trip so the in-memory + on-disk shapes stay aligned.
 */
interface PersistedShape {
  readonly globalDefaults: SerializedPrefs;
  readonly perCardOverrides: Readonly<Record<string, SerializedPrefs>>;
  readonly perGroupOverrides: Readonly<Record<string, SerializedPrefs>>;
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

const DEFAULT_GLOBAL = defaultSharingPreferencesForLevel('professional');

interface State {
  readonly globalDefaults: SharingPreferences;
  readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly setGlobalDefaults: (prefs: SharingPreferences) => void;
  readonly setCardOverride: (cardId: string, prefs: SharingPreferences | null) => void;
  readonly setGroupOverride: (groupId: string, prefs: SharingPreferences | null) => void;
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
}): PersistedShape {
  const cards: Record<string, SerializedPrefs> = {};
  for (const [k, v] of Object.entries(s.perCardOverrides)) cards[k] = serialize(v);
  const groups: Record<string, SerializedPrefs> = {};
  for (const [k, v] of Object.entries(s.perGroupOverrides)) groups[k] = serialize(v);
  return {
    globalDefaults: serialize(s.globalDefaults),
    perCardOverrides: cards,
    perGroupOverrides: groups,
  };
}

function persistedToState(p: PersistedShape): {
  readonly globalDefaults: SharingPreferences;
  readonly perCardOverrides: Readonly<Record<string, SharingPreferences>>;
  readonly perGroupOverrides: Readonly<Record<string, SharingPreferences>>;
} {
  const cards: Record<string, SharingPreferences> = {};
  for (const [k, v] of Object.entries(p.perCardOverrides)) cards[k] = deserialize(v);
  const groups: Record<string, SharingPreferences> = {};
  for (const [k, v] of Object.entries(p.perGroupOverrides)) groups[k] = deserialize(v);
  return {
    globalDefaults: deserialize(p.globalDefaults),
    perCardOverrides: cards,
    perGroupOverrides: groups,
  };
}

export const useSharingSettings = create<State>((set, get) => ({
  globalDefaults: DEFAULT_GLOBAL,
  perCardOverrides: {},
  perGroupOverrides: {},

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

  resolveFor: (cardId, card, audience, groupContext) => {
    const s = get();
    return resolveCardForAudience({
      card,
      audience,
      perCardPrefs: s.perCardOverrides[cardId],
      groupContext,
      globalDefaults: s.globalDefaults,
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
  });
}
