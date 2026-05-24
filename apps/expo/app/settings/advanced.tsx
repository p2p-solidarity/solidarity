/**
 * Advanced settings — 1:1 port of
 * solidarity/Views/SettingsViews/AdvancedSettingsView.swift.
 *
 * Sections (top → bottom):
 *   1. Interface — Appearance link.
 *   2. Developer Tools (dev mode only) — Group Management, Passport Pipeline,
 *      Simulate NFC toggle, ZK Identity Settings, OIDC Request Scanner.
 *   3. Danger Zone — Reset App Data + (dev mode) Reset Passport Credential,
 *      Wipe Everything, Disable Developer Mode, plus a mono footer that
 *      hints how to enable dev mode while it's off.
 *
 * Destructive actions require biometric authentication when the matching
 * `biometricPolicy.rotateMasterKey` flag is on (mirrors Swift
 * `BiometricGatekeeper.authorizeIfRequired(.rotateMasterKey)`).
 *
 * TODO(android): the Swift original performs `StorageManager.clearAllData`,
 * `KeychainService.shared.deleteSigningKey`, `OfflineManager` cleanup, and a
 * keychain sweep. The Expo port performs the analogous TS operations: reset
 * preferences via `usePreferences.reset()`, wipe MMKV, clear the signing key
 * via `resetSigningKeyForTesting`. Some Swift-only paths (CKContainer,
 * `EncryptionManager.deleteEncryptionKey`) are gated behind TODOs.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { pushToast } from '@/feedback/toast';
import {
  ensureSigningKey,
  requireBiometric,
  resetSigningKeyForTesting,
} from '@/keychain';
import { usePreferences } from '@/settings/preferences';
import { getMmkv } from '@/storage/mmkv';

const MONO_FONT = 'Menlo';

export default function AdvancedSettings() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);
  const simulateNfc = usePreferences((s) => s.simulateNfc);
  const policy = usePreferences((s) => s.biometricPolicy);
  const setPref = usePreferences((s) => s.set);
  const resetPrefs = usePreferences((s) => s.reset);

  const [busy, setBusy] = useState(false);

  const requireRotateAuth = async (): Promise<boolean> => {
    if (!policy.rotateMasterKey) return true;
    return requireBiometric('delete');
  };

  const onResetAppData = () => {
    Alert.alert(
      'Reset local app data?',
      'This clears local encrypted files, contacts, credentials, and onboarding status. Keys are preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => { void resetAppData(); },
        },
      ]
    );
  };

  const resetAppData = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await requireRotateAuth();
      if (!ok) {
        setBusy(false);
        return;
      }
      // Mirrors Swift: clear local storage but preserve keys.
      const mmkv = getMmkv();
      for (const k of mmkv.getAllKeys()) {
        if (k.startsWith('vc:')) mmkv.remove(k);
        if (k.startsWith('group:')) mmkv.remove(k);
        if (k.startsWith('member:')) mmkv.remove(k);
        if (k.startsWith('contact:')) mmkv.remove(k);
      }
      resetPrefs();
      pushToast('Local data reset completed.', 'success');
    } catch (err) {
      Alert.alert('Settings', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onResetPassport = () => {
    // Mirrors Swift: IdentityDataStore.shared.removePassportCredentials()
    const mmkv = getMmkv();
    for (const k of mmkv.getAllKeys()) {
      if (k.startsWith('vc:passport') || k.startsWith('passport:')) {
        mmkv.remove(k);
      }
    }
    Alert.alert('Settings', 'Passport credential has been reset.');
  };

  const onWipeEverything = () => {
    Alert.alert(
      'Wipe everything?',
      'This deletes ALL data including private keys, DIDs, credentials, and keychain items. Relaunch the app after wipe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe',
          style: 'destructive',
          onPress: () => { void wipeEverything(); },
        },
      ]
    );
  };

  const wipeEverything = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await requireRotateAuth();
      if (!ok) {
        setBusy(false);
        return;
      }
      // Wipe MMKV.
      const mmkv = getMmkv();
      for (const k of mmkv.getAllKeys()) mmkv.remove(k);
      // Reset preferences.
      resetPrefs();
      // Drop the signing key + regenerate.
      await resetSigningKeyForTesting();
      await ensureSigningKey();
      Alert.alert('Settings', 'All data wiped. Please relaunch the app.');
    } catch (err) {
      Alert.alert('Settings', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDisableDeveloperMode = () => {
    setPref('developerMode', false);
    // Mirrors Swift DeveloperModeManager.disableDeveloperMode toast.
    pushToast('Developer Mode Disabled', 'info', 2000);
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Advanced" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Interface */}
          <SettingsBlockSection title="Interface">
            <SettingsBlockRow
              icon="paintbrush"
              title="Appearance"
              onPress={() => { router.push('/settings/appearance'); }}
            />
          </SettingsBlockSection>

          {/* Developer Tools */}
          {developerMode ? (
            <SettingsBlockSection title="Developer Tools">
              <SettingsBlockRow
                icon="person.3"
                title="Group Management"
                onPress={() => { router.push('/settings/groups'); }}
              />
              <SettingsBlockRow
                icon="doc.viewfinder"
                title="Passport Pipeline"
                onPress={() => { router.push('/passport'); }}
              />
              <SettingsBlockToggleRow
                icon="wave.3.forward"
                title="Simulate NFC"
                value={simulateNfc}
                onValueChange={(v) => { setPref('simulateNfc', v); }}
              />
              <SettingsBlockRow
                icon="shield.checkered"
                title="ZK Identity Settings"
                onPress={() => {
                  pushToast('ZK Identity Settings lands next iteration', 'info');
                }}
              />
              <SettingsBlockRow
                icon="qrcode"
                title="OIDC Request Scanner"
                onPress={() => { router.push('/settings/oidc-request'); }}
              />
            </SettingsBlockSection>
          ) : null}

          {/* Danger Zone */}
          <View className="gap-3">
            <SettingsBlockSectionHeader title="Danger Zone" />
            <View className="px-4 gap-2">
              <SettingsBlockDangerRow
                icon="arrow.counterclockwise"
                title="Reset App Data"
                subtitle="Clears data, preserves keys"
                onPress={onResetAppData}
              />

              {developerMode ? (
                <>
                  <SettingsBlockDangerRow
                    icon="xmark.bin"
                    title="Reset Passport Credential"
                    onPress={onResetPassport}
                  />
                  <SettingsBlockDangerRow
                    icon="trash.slash"
                    title="Wipe Everything"
                    subtitle="Deletes all data + keys"
                    onPress={onWipeEverything}
                  />
                  <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.08)' }} />
                  <SettingsBlockRow
                    icon="xmark.circle"
                    title="Disable Developer Mode"
                    showsChevron={false}
                    onPress={onDisableDeveloperMode}
                  />
                </>
              ) : null}
            </View>

            {!developerMode ? (
              <Text
                className="text-text3 text-[10px] px-6"
                style={{ fontFamily: MONO_FONT }}
              >
                Tap the version number in Settings to enable developer mode.
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
