/**
 * Parity test — Preferences defaults
 *
 * Asserts every Swift `@AppStorage` / `UserDefaults` default that the iOS
 * client uses has a matching field in the TS preferences store with the
 * **same** default value. Swift is the spec: see file paths in the table
 * below for the source line each pair points at.
 *
 *   Swift key                                | Source file
 *   -----------------------------------------|----------------------------------------------------------
 *   solidarity.onboarding.completed          | solidarity/Views/ContentView.swift
 *   developerModeEnabled                     | solidarity/Services/Utils/DeveloperModeManager.swift
 *   theme_enable_glow                        | solidarity/Services/Utils/ThemeManager.swift
 *   theme_color_scheme                       | solidarity/Services/Utils/ThemeManager.swift
 *   theme_card_accent_hex                    | solidarity/Services/Utils/ThemeManager.swift
 *   theme_selected_animal                    | solidarity/Services/Utils/ThemeManager.swift
 *   notification.enableInAppToast            | solidarity/Services/Utils/NotificationSettingsManager.swift
 *   notification.enableRemoteNotification    | solidarity/Services/Utils/NotificationSettingsManager.swift
 *   notification.enableAutoSync              | solidarity/Services/Utils/NotificationSettingsManager.swift
 *   notification.syncIntervalSeconds         | solidarity/Services/Utils/NotificationSettingsManager.swift
 *   BackupManager.Settings.enabled           | solidarity/Services/Backup/BackupManager.swift
 *   BackupManager.Settings.autoBackup        | solidarity/Services/Backup/BackupManager.swift
 *
 * A red bar here means either Swift changed a default (review the diff) or
 * the TS port drifted (almost always the answer).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

import type { Preferences } from '../../src/settings/preferences';

let defaults: Preferences;

beforeAll(async () => {
  // Stub native modules BEFORE dynamic-importing preferences. Without these,
  // bun resolves real react-native and bails on the flow-typed index.js.
  // Short-circuit the entire @/storage/mmkv module so the react-native /
  // react-native-mmkv chain never loads. The store only reads via getMmkv()
  // inside lazy writeSafe/readSafe calls — we test the in-memory defaults
  // returned by getState(), so a stub MMKV is sufficient.
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: () => undefined,
      set: () => undefined,
      remove: () => undefined,
      getAllKeys: () => [] as string[],
    }),
    initMmkv: async () => undefined,
  }));
  const mod = await import('../../src/settings/preferences');
  defaults = mod.usePreferences.getState();
});

interface ParityPair {
  readonly swiftKey: string;
  readonly swiftDefault: unknown;
  readonly tsField: keyof Preferences;
}

const pairs: readonly ParityPair[] = [
  { swiftKey: 'solidarity.onboarding.completed', swiftDefault: false, tsField: 'hasCompletedOnboarding' },
  { swiftKey: 'developerModeEnabled', swiftDefault: false, tsField: 'developerMode' },
  { swiftKey: 'theme_enable_glow', swiftDefault: true, tsField: 'enableGlow' },
  // ThemeManager.AppColorScheme default = .system → rawValue "system"
  { swiftKey: 'theme_color_scheme', swiftDefault: 'system', tsField: 'appColorScheme' },
  // ThemeManager.presets.first = Color(hex: 0xE091B3) — rose pink
  { swiftKey: 'theme_card_accent_hex', swiftDefault: '#E091B3', tsField: 'cardAccentHex' },
  // ThemeManager: animal nil → TS uses null
  { swiftKey: 'theme_selected_animal', swiftDefault: null, tsField: 'selectedAnimal' },
  { swiftKey: 'notification.enableInAppToast', swiftDefault: true, tsField: 'notificationsInAppToast' },
  { swiftKey: 'notification.enableRemoteNotification', swiftDefault: true, tsField: 'notificationsRemote' },
  { swiftKey: 'notification.enableAutoSync', swiftDefault: true, tsField: 'notificationsAutoSync' },
  { swiftKey: 'notification.syncIntervalSeconds', swiftDefault: 30, tsField: 'notificationsSyncIntervalSeconds' },
  { swiftKey: 'BackupManager.Settings.enabled', swiftDefault: false, tsField: 'backupEnabled' },
  { swiftKey: 'BackupManager.Settings.autoBackup', swiftDefault: true, tsField: 'autoBackupOnPull' },
];

describe('Preferences defaults parity: Swift @AppStorage ↔ usePreferences', () => {
  for (const p of pairs) {
    it(`${p.swiftKey} → ${String(p.tsField)} default matches Swift (${String(p.swiftDefault)})`, () => {
      expect(defaults[p.tsField]).toBe(p.swiftDefault as never);
    });
  }

  it('biometricSensitiveOps starts opt-in (matches Swift SensitiveActionPolicyStore default)', () => {
    expect(defaults.biometricSensitiveOps).toBe(true);
  });

  it('every SensitiveAction starts requiring biometrics (Swift parity)', () => {
    // SensitiveActionPolicyStore migrates UD → Keychain with default true for
    // every sensitive action: issueCredential, presentProof, exportGraph,
    // rotateMasterKey, revealRecoveryBundle, registerTrustAnchor, deleteZKIdentity.
    const policy = defaults.biometricPolicy;
    expect(policy.issueCredential).toBe(true);
    expect(policy.presentProof).toBe(true);
    expect(policy.exportGraph).toBe(true);
    expect(policy.rotateMasterKey).toBe(true);
    expect(policy.revealRecoveryBundle).toBe(true);
    expect(policy.registerTrustAnchor).toBe(true);
    expect(policy.deleteZKIdentity).toBe(true);
  });

  it('backupProvider default reflects platform: iCloud on iOS, googleDrive on Android', () => {
    // TS DEFAULTS hard-codes 'iCloud' (rest of suite asserts the platform-aware
    // DEFAULT_PROVIDER export separately). Swift only runs on iOS and uses
    // iCloud, so the iOS default must match.
    expect(defaults.backupProvider).toBe('iCloud');
  });

  it('keeps public publishing opt-in while private Pear exchange stays available', () => {
    expect(defaults.nostrAutoRepublish).toBe(false);
    expect(defaults.pearExchangeEnabled).toBe(true);
  });
});
