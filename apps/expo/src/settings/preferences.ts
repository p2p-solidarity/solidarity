/**
 * App preferences — zustand-backed prefs persisted in MMKV. Mirrors Swift
 * UserDefaults-derived stores (NotificationSettingsManager, ShareSettingsStore,
 * BackupSettings, etc.) collapsed into one TS surface.
 *
 * Reads start with DEFAULTS so the store is safe to subscribe to BEFORE
 * `initMmkv()` finishes. Call `hydratePreferences()` from the root layout
 * after MMKV is ready to swap in the persisted values. Writes are best-
 * effort — they swallow MMKV errors so a not-yet-initialised store doesn't
 * crash the render.
 */
import { create } from 'zustand';

import { getMmkv } from '@/storage/mmkv';
import type { ProviderKind } from '@/backup';

const KEY = 'prefs:v1';

export interface Preferences {
  readonly hasCompletedOnboarding: boolean;
  readonly biometricSensitiveOps: boolean;
  readonly backupProvider: ProviderKind;
  readonly autoBackupOnPull: boolean;
  readonly notificationsEnabled: boolean;
  readonly developerMode: boolean;
  readonly themeMode: 'auto' | 'light' | 'dark';
}

const DEFAULTS: Preferences = {
  hasCompletedOnboarding: false,
  biometricSensitiveOps: true,
  backupProvider: 'iCloud',
  autoBackupOnPull: true,
  notificationsEnabled: true,
  developerMode: false,
  themeMode: 'auto',
};

function readSafe(): Preferences {
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULTS;
  }
}

function writeSafe(p: Preferences): void {
  try {
    getMmkv().set(KEY, JSON.stringify(p));
  } catch {
    // MMKV not ready / disk full — fail closed; UI state is the truth.
  }
}

interface PrefsState extends Preferences {
  readonly set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  readonly reset: () => void;
}

export const usePreferences = create<PrefsState>((set) => ({
  ...DEFAULTS,
  set: (key, value) => {
    set((s) => {
      const next = { ...s, [key]: value } as Preferences;
      writeSafe(next);
      return { [key]: value } as Partial<PrefsState>;
    });
  },
  reset: () => {
    writeSafe(DEFAULTS);
    set(DEFAULTS);
  },
}));

/**
 * Swap the in-memory defaults for the persisted ones. Call once from the
 * root layout, after `initMmkv()` resolves.
 */
export function hydratePreferences(): void {
  usePreferences.setState(readSafe());
}
