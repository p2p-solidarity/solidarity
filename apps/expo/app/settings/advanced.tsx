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
import { ScrollView, Text, View } from 'react-native';
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
import { appAlert, showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useIdentityData } from '@/identity';
import {
  ensureSigningKey,
  requireBiometric,
  resetSigningKeyForTesting,
} from '@/keychain';
import { usePreferences } from '@/settings/preferences';
import { getMmkv } from '@/storage/mmkv';
import { clearAll as clearPassportAnchors } from '@/zk/passportAnchorStore';

const MONO_FONT = 'Menlo';

export default function AdvancedSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const simulateNfc = usePreferences((s) => s.simulateNfc);
  const policy = usePreferences((s) => s.biometricPolicy);
  const setPref = usePreferences((s) => s.set);
  const resetPrefs = usePreferences((s) => s.reset);
  const removePassportCredentials = useIdentityData((s) => s.removePassportCredentials);

  const [busy, setBusy] = useState(false);

  const requireRotateAuth = async (): Promise<boolean> => {
    if (!policy.rotateMasterKey) return true;
    return requireBiometric('delete');
  };

  const onResetAppData = async () => {
    const ok = await confirmDialog({
      title: t('advanced.resetAppData.confirmTitle'),
      message: t('advanced.resetAppData.confirmMessage'),
      confirmLabel: t('advanced.resetAppData.confirmAction'),
      destructive: true,
    });
    if (!ok) return;
    await resetAppData();
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
      pushToast(t('advanced.resetAppData.done'), 'success');
    } catch (err) {
      showError({ context: 'Advanced › Reset App Data', summary: t('advanced.resetAppData.failed'), error: err });
    } finally {
      setBusy(false);
    }
  };

  const onResetPassport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Mirrors Swift: IdentityDataStore.shared.removePassportCredentials()
      await removePassportCredentials();
      clearPassportAnchors();
      const mmkv = getMmkv();
      for (const k of mmkv.getAllKeys()) {
        if (k.startsWith('passport:')) mmkv.remove(k);
      }
      appAlert({ title: t('advanced.settingsTitle'), message: t('advanced.resetPassport.done') });
    } catch (err) {
      showError({
        context: 'Advanced › Reset Passport Credential',
        summary: t('advanced.resetAppData.failed'),
        error: err,
      });
    } finally {
      setBusy(false);
    }
  };

  const onWipeEverything = async () => {
    const ok = await confirmDialog({
      title: t('advanced.wipe.confirmTitle'),
      message: t('advanced.wipe.confirmMessage'),
      confirmLabel: t('advanced.wipe.confirmAction'),
      destructive: true,
    });
    if (!ok) return;
    await wipeEverything();
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
      appAlert({ title: t('advanced.settingsTitle'), message: t('advanced.wipe.done') });
    } catch (err) {
      showError({ context: 'Advanced › Wipe Everything', summary: t('advanced.wipe.failed'), error: err });
    } finally {
      setBusy(false);
    }
  };

  const onDisableDeveloperMode = () => {
    setPref('developerMode', false);
    // Mirrors Swift DeveloperModeManager.disableDeveloperMode toast.
    pushToast(t('advanced.devModeDisabled'), 'info', 2000);
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('advanced.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Interface */}
          <SettingsBlockSection title={t('advanced.section.interface')}>
            <SettingsBlockRow
              icon="paintbrush"
              title={t('advanced.appearance')}
              onPress={() => { router.push('/settings/appearance'); }}
            />
            <SettingsBlockRow
              icon="globe"
              title={t('advanced.language')}
              onPress={() => { router.push('/settings/language'); }}
            />
            <SettingsBlockRow
              icon="bell"
              title={t('advanced.notifications')}
              onPress={() => { router.push('/settings/notifications'); }}
            />
          </SettingsBlockSection>

          {/* Developer Tools */}
          {developerMode ? (
            <SettingsBlockSection title={t('advanced.section.devTools')}>
              <SettingsBlockRow
                icon="person.3"
                title={t('advanced.groupManagement')}
                onPress={() => { router.push('/settings/groups'); }}
              />
              <SettingsBlockRow
                icon="doc.viewfinder"
                title={t('advanced.passportPipeline')}
                onPress={() => { router.push('/passport'); }}
              />
              <SettingsBlockToggleRow
                icon="wave.3.forward"
                title={t('advanced.simulateNfc')}
                value={simulateNfc}
                onValueChange={(v) => { setPref('simulateNfc', v); }}
              />
              <SettingsBlockRow
                icon="shield.checkered"
                title={t('advanced.zkSettings')}
                onPress={() => { router.push('/id/zk-settings'); }}
              />
              <SettingsBlockRow
                icon="qrcode"
                title={t('advanced.oidcScanner')}
                onPress={() => { router.push('/settings/oidc-request'); }}
              />
            </SettingsBlockSection>
          ) : null}

          {/* Danger Zone */}
          <View className="gap-3">
            <SettingsBlockSectionHeader title={t('advanced.section.dangerZone')} />
            <View className="px-4 gap-2">
              <SettingsBlockDangerRow
                icon="arrow.counterclockwise"
                title={t('advanced.resetAppData')}
                subtitle={t('advanced.resetAppData.subtitle')}
                onPress={() => { void onResetAppData(); }}
              />

              <SettingsBlockDangerRow
                icon="xmark.bin"
                title={t('advanced.resetPassport')}
                onPress={() => { void onResetPassport(); }}
              />

              {developerMode ? (
                <>
                  <SettingsBlockDangerRow
                    icon="trash.slash"
                    title={t('advanced.wipe')}
                    subtitle={t('advanced.wipe.subtitle')}
                    onPress={() => { void onWipeEverything(); }}
                  />
                  <View style={{ height: 1, backgroundColor: 'rgba(0,0,0,0.08)' }} />
                  <SettingsBlockRow
                    icon="xmark.circle"
                    title={t('advanced.disableDevMode')}
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
                {t('advanced.devModeHint')}
              </Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
