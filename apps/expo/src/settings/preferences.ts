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

/** Per-action biometric requirement flags (mirrors Swift SensitiveAction). */
export type SensitiveActionKey =
  | 'issueCredential'
  | 'presentProof'
  | 'exportGraph'
  | 'rotateMasterKey'
  | 'revealRecoveryBundle'
  | 'registerTrustAnchor'
  | 'deleteZKIdentity';

/** Mirrors Swift AppColorScheme (system / light / dark). */
export type AppColorScheme = 'system' | 'light' | 'dark';

/** Mirrors Swift AnimalCharacter. */
export type AnimalCharacter = 'dog' | 'horse' | 'pig' | 'sheep' | 'dove';

export interface Preferences {
  readonly hasCompletedOnboarding: boolean;
  readonly biometricSensitiveOps: boolean;
  readonly backupProvider: ProviderKind;
  readonly autoBackupOnPull: boolean;
  readonly notificationsEnabled: boolean;
  readonly developerMode: boolean;
  readonly themeMode: 'auto' | 'light' | 'dark';
  /** Mirrors Swift ThemeManager.appColorScheme. */
  readonly appColorScheme: AppColorScheme;
  /** Mirrors Swift ThemeManager.cardAccent (hex). */
  readonly cardAccentHex: string;
  /** Mirrors Swift ThemeManager.enableGlow. */
  readonly enableGlow: boolean;
  /** Mirrors Swift ThemeManager.selectedAnimal (null = none). */
  readonly selectedAnimal: AnimalCharacter | null;
  /** Per-action Face ID requirement flags (Swift SensitiveActionPolicyStore). */
  readonly biometricPolicy: Readonly<Record<SensitiveActionKey, boolean>>;
  /** Mirrors Swift BackupSettings.enabled. */
  readonly backupEnabled: boolean;
  /** Mirrors Swift NotificationSettingsManager.enableInAppToast. */
  readonly notificationsInAppToast: boolean;
  /** Mirrors Swift NotificationSettingsManager.enableRemoteNotification. */
  readonly notificationsRemote: boolean;
  /** Mirrors Swift NotificationSettingsManager.enableAutoSync. */
  readonly notificationsAutoSync: boolean;
  /** Mirrors Swift NotificationSettingsManager.syncIntervalSeconds. */
  readonly notificationsSyncIntervalSeconds: number;
  /** Mirrors Swift DeveloperModeManager.simulateNFC. */
  readonly simulateNfc: boolean;
  /** Share-field toggles — mirror Swift ShareSettingsView @AppStorage keys. */
  readonly shareTitle: boolean;
  readonly shareCompany: boolean;
  readonly shareEmail: boolean;
  readonly sharePhone: boolean;
  readonly shareProfileImage: boolean;
  readonly shareSocialNetworks: boolean;
  readonly shareSkills: boolean;
  /** Mirrors Swift `@AppStorage("share_proof_is_human")` — locked-on once the
   * holder owns a `is_human` claim. */
  readonly shareIsHuman: boolean;
  readonly shareAgeOver18: boolean;
  /** Active UI language tag (`en`, `zh-Hant`). Mirrors Swift LanguageSelectionView. */
  readonly language: string;
  /**
   * Root-key (seed-derived did:key, `src/identity/rootKey.ts`) backup
   * consent — recorded at the onboarding `backup.tsx` step. `'icloud'` is
   * the recommended one-tap path; `'mnemonicOnly'` means the user completed
   * the write-it-down ceremony instead. This is an INTENT flag, not proof
   * that iCloud sync is active — see rootKey.ts's module doc for the
   * current storage-capability ceiling.
   */
  readonly rootKeySyncChoice: 'undecided' | 'icloud' | 'mnemonicOnly';
}

const DEFAULT_BIOMETRIC_POLICY: Readonly<Record<SensitiveActionKey, boolean>> = {
  issueCredential: true,
  presentProof: true,
  exportGraph: true,
  rotateMasterKey: true,
  revealRecoveryBundle: true,
  registerTrustAnchor: true,
  deleteZKIdentity: true,
};

const DEFAULTS: Preferences = {
  hasCompletedOnboarding: false,
  biometricSensitiveOps: true,
  backupProvider: 'iCloud',
  autoBackupOnPull: true,
  notificationsEnabled: true,
  developerMode: false,
  themeMode: 'auto',
  appColorScheme: 'system',
  cardAccentHex: '#E091B3',
  enableGlow: true,
  selectedAnimal: null,
  biometricPolicy: DEFAULT_BIOMETRIC_POLICY,
  backupEnabled: false,
  notificationsInAppToast: true,
  notificationsRemote: true,
  notificationsAutoSync: true,
  notificationsSyncIntervalSeconds: 30,
  simulateNfc: false,
  shareTitle: false,
  shareCompany: false,
  shareEmail: false,
  sharePhone: false,
  shareProfileImage: false,
  shareSocialNetworks: false,
  shareSkills: false,
  shareIsHuman: true,
  shareAgeOver18: false,
  // Empty = "no explicit choice yet → follow device locale" (resolved in
  // installI18n). Only a real selection ('en' | 'zh-Hant') persists and
  // overrides the device locale on relaunch.
  language: '',
  rootKeySyncChoice: 'undecided',
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
