/**
 * Developer Options is the only product entry for protocol vocabulary and
 * diagnostic tools. The route itself stays gated so a deep link cannot bypass
 * Settings -> Version -> five taps.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  invalidateCachedAtprotoResult,
  invalidateCachedNostrResult,
} from '@/badges/badgeStatusCache';
import {
  SettingsBackToolbar,
  SettingsBlockDangerRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedText } from '@/components/themed';
import { appAlert, showError } from '@/feedback/appAlert';
import { confirmDialog } from '@/feedback/confirmDialog';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { requireBiometric } from '@/keychain';
import { safeBack } from '@/navigation/safeBack';
import { usePreferences } from '@/settings/preferences';
import { wipeLocalDevice } from '@/settings/productionWipe';

export default function DeveloperSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((state) => state.developerMode);
  const simulateNfc = usePreferences((state) => state.simulateNfc);
  const policy = usePreferences((state) => state.biometricPolicy);
  const setPref = usePreferences((state) => state.set);
  const [busy, setBusy] = useState(false);

  const onWipeEverything = async () => {
    const confirmed = await confirmDialog({
      title: t('advanced.wipe.confirmTitle'),
      message: t('advanced.wipe.confirmMessage'),
      confirmLabel: t('advanced.wipe.confirmAction'),
      destructive: true,
    });
    if (!confirmed || busy) return;

    setBusy(true);
    try {
      if (policy.rotateMasterKey) {
        const authorized = await requireBiometric('delete');
        if (!authorized) return;
      }

      const result = await wipeLocalDevice();
      if (result.kind === 'incomplete') {
        throw new Error(`Incomplete local wipe: ${result.failedTargets.join(', ')}`);
      }
      appAlert({
        title: t('advanced.settingsTitle'),
        message: t('advanced.wipe.done'),
      });
      router.replace('/onboarding');
    } catch (error) {
      showError({
        context: 'Developer Options › Wipe Everything',
        summary: t('advanced.wipe.failed'),
        error,
      });
    } finally {
      setBusy(false);
    }
  };

  const clearVerificationCache = () => {
    invalidateCachedNostrResult();
    invalidateCachedAtprotoResult();
    pushToast(t('developer.checkEngine.cacheCleared'), 'success');
  };

  if (!developerMode) {
    return (
      <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
        <SettingsBackToolbar onPress={() => { safeBack('/settings/advanced'); }} />
        <SettingsScreenTitle title={t('developer.title')} />
        <ThemedText variant="caption" tone="secondary" className="px-4 pt-6">
          {t('developer.locked')}
        </ThemedText>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { safeBack('/settings/advanced'); }} />
      <SettingsScreenTitle title={t('developer.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 + insets.bottom }}>
        <View className="gap-6">
          <View className="px-4">
            <ThemedText variant="caption" tone="secondary">
              {t('developer.warning')}
            </ThemedText>
          </View>

          <SettingsBlockSection title={t('developer.mode.header')}>
            <SettingsBlockToggleRow
              icon="hammer"
              title={t('developer.mode.toggle')}
              value
              onValueChange={(next) => {
                if (!next) setPref('developerMode', false);
              }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.identityKeys.header')}>
            <SettingsBlockRow
              icon="person.text.rectangle"
              title={t('developer.identityKeys.inspector')}
              subtitle={t('developer.identityKeys.inspectorSubtitle')}
              onPress={() => {
                router.push({ pathname: '/settings/dids', params: { readOnly: '1' } });
              }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.credentials.header')}>
            <SettingsBlockRow
              icon="checkmark.shield"
              title={t('developer.credentials.library')}
              subtitle={t('developer.credentials.librarySubtitle')}
              onPress={() => { router.push('/credentials'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.present.header')}>
            <SettingsBlockRow
              icon="wrench.and.screwdriver"
              title={t('developer.present.verificationTools')}
              subtitle={t('developer.present.verificationToolsSubtitle')}
              onPress={() => { router.push('/settings/developer/verification'); }}
            />
            <SettingsBlockRow
              icon="qrcode.viewfinder"
              title={t('developer.present.scanRequest')}
              onPress={() => { router.push('/scan'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.receive.header')}>
            <SettingsBlockRow
              icon="square.and.arrow.down"
              title={t('developer.receive.scanOffer')}
              subtitle={t('developer.receive.scanOfferSubtitle')}
              onPress={() => { router.push('/scan'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.checkEngine.header')}>
            <SettingsBlockRow
              icon="arrow.clockwise"
              title={t('developer.checkEngine.clearCache')}
              subtitle={t('developer.checkEngine.clearCacheSubtitle')}
              showsChevron={false}
              onPress={clearVerificationCache}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.publishSync.header')}>
            <SettingsBlockRow
              icon="antenna.radiowaves.left.and.right"
              title={t('developer.publishSync.locations')}
              onPress={() => { router.push('/settings/connections'); }}
            />
            <SettingsBlockRow
              icon="arrow.up.arrow.down.square"
              title={t('developer.publishSync.data')}
              onPress={() => { router.push('/settings/data-sync'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('developer.simulators.header')}>
            <SettingsBlockToggleRow
              icon="wave.3.right"
              title={t('developer.simulators.nfc')}
              subtitle={t('developer.simulators.nfcSubtitle')}
              value={simulateNfc}
              onValueChange={(next) => { setPref('simulateNfc', next); }}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <SettingsBlockSectionHeader title={t('developer.dangerZone.header')} />
            <View className="px-4 gap-2">
              <SettingsBlockDangerRow
                icon="trash.slash"
                title={t('developer.dangerZone.wipe')}
                subtitle={t('developer.dangerZone.wipeSubtitle')}
                onPress={() => { void onWipeEverything(); }}
              />
              <SettingsBlockDangerRow
                icon="xmark.circle"
                title={t('developer.dangerZone.disable')}
                onPress={() => {
                  setPref('developerMode', false);
                  pushToast(t('advanced.devModeDisabled'), 'info', 2000);
                }}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
