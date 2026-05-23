/**
 * App preferences — zustand-backed prefs persisted in MMKV. Mirrors Swift
 * UserDefaults-derived stores (NotificationSettingsManager, ShareSettingsStore,
 * BackupSettings, etc.) collapsed into one TS surface.
 *
 * Reads sync from MMKV on first access; writes write-through. UI components
 * use `usePreferences()` with selector for granular re-render.
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

function read(): Preferences {
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Preferences>) };
  } catch {
    return DEFAULTS;
  }
}

function write(p: Preferences): void {
  getMmkv().set(KEY, JSON.stringify(p));
}

interface PrefsState extends Preferences {
  readonly set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  readonly reset: () => void;
}

export const usePreferences = create<PrefsState>((set) => {
  const initial = read();
  return {
    ...initial,
    set: (key, value) =>
      set((s) => {
        const next = { ...s, [key]: value } as Preferences;
        write(next);
        return { [key]: value } as Partial<PrefsState>;
      }),
    reset: () => {
      write(DEFAULTS);
      set(DEFAULTS);
    },
  };
});
