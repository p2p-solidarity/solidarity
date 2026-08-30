/**
 * Reset Options contains only destructive, product-facing reset actions.
 * Top-level preferences and Developer Options both live on the Settings hub,
 * so this screen does not duplicate either navigation surface.
 *
 * Destructive actions require biometric authentication when the matching
 * `biometricPolicy.rotateMasterKey` flag is on (mirrors Swift
 * `BiometricGatekeeper.authorizeIfRequired(.rotateMasterKey)`).
 *
 * Reset App Data clears the complete MMKV store and the in-memory store
 * mirrors hydrated from it, restores preference defaults, and deliberately
 * preserves recovery/signing keys held outside MMKV.
 */
import { router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
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
import { resetAppDataKeepingKeys } from '@/settings/productionWipe';
import { getMmkv } from '@/storage/mmkv';
import { clearAll as clearPassportAnchors } from '@/zk/passportAnchorStore';

export default function ResetOptions() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const policy = usePreferences((s) => s.biometricPolicy);
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
      await resetAppDataKeepingKeys();
      pushToast(t('advanced.resetAppData.done'), 'success');
      router.replace('/onboarding');
    } catch (err) {
      showError({ context: 'Reset Options › Reset App Data', summary: t('advanced.resetAppData.failed'), error: err });
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
        context: 'Reset Options › Reset Passport Credential',
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
