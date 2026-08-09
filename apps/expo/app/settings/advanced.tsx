/**
 * Advanced settings — 1:1 port of
 * solidarity/Views/SettingsViews/AdvancedSettingsView.swift.
 *
 * Sections (top → bottom):
 *   1. Interface — Appearance link.
 *   2. Developer Tools (dev mode only) — the single Developer Options entry.
 *   3. Danger Zone — product-facing reset actions. Developer-only wipe and
 *      mode controls live inside the gated Developer Options screen.
 *
 * Destructive actions require biometric authentication when the matching
 * `biometricPolicy.rotateMasterKey` flag is on (mirrors Swift
 * `BiometricGatekeeper.authorizeIfRequired(.rotateMasterKey)`).
 *
 * Reset App Data clears the complete MMKV store, restores preference defaults,
 * and deliberately preserves recovery/signing keys held outside MMKV.
 */
import { router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { appAlert, showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { useIdentityData } from '@/identity';
import { requireBiometric } from '@/keychain';
import { usePreferences } from '@/settings/preferences';
import { clearAllData } from '@/storage';
import { getMmkv } from '@/storage/mmkv';
import { clearAll as clearPassportAnchors } from '@/zk/passportAnchorStore';

export default function AdvancedSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const policy = usePreferences((s) => s.biometricPolicy);
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
      // Clears cards, contacts, manifests, credentials, and every other MMKV
      // record. Keychain-backed recovery/signing keys are intentionally kept.
      clearAllData();
      resetPrefs();
      pushToast(t('advanced.resetAppData.done'), 'success');
      router.replace('/onboarding');
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

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings'); }} />
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

          {/* One hidden entry point for every technical/developer surface. */}
          {developerMode ? (
            <SettingsBlockSection title={t('advanced.section.devTools')}>
              <SettingsBlockRow
                icon="hammer"
                title={t('advanced.developerOptions')}
                onPress={() => { router.push('/settings/developer'); }}
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
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
