/**
 * Settings hub — 1:1 port of solidarity/Views/SettingsViews/SettingsView.swift.
 *
 * Five blocks: Account & Identity, QR Sharing, Preferences, Guide, About.
 * Each row is a SettingsBlockRow on a `mutedSurface` 12pt card, stacked
 * 8pt apart. Sections themselves are 24pt apart. About section is rendered
 * inline (no SettingsBlockSection wrapper, since the version row uses the
 * Info-row variant + 14pt header + 12pt spacing).
 */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

const DEV_TAP_THRESHOLD = 7;

export default function SettingsHub() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const setPref = usePreferences((s) => s.set);
  const tapCountRef = useRef(0);

  const version = Constants.expoConfig?.version ?? 'Unknown';

  // Mirrors Swift DeveloperModeManager.registerVersionTap — 5/6 taps show a
  // "N taps away" hint, the 7th flips developerMode on with success toast
  // + haptic. The counter lives in a ref (component-local, not persisted).
  const onVersionTap = () => {
    if (developerMode) return;
    tapCountRef.current += 1;
    const count = tapCountRef.current;
    if (count >= DEV_TAP_THRESHOLD) {
      tapCountRef.current = 0;
      setPref('developerMode', true);
      haptic('success');
      pushToast(
        t('settingsHub.devUnlock.enabled'),
        'success',
        3000
      );
    } else if (count >= 5) {
      const remaining = DEV_TAP_THRESHOLD - count;
      const message = remaining === 1
        ? t('settingsHub.devUnlock.almostOne')
        : t('settingsHub.devUnlock.almostMany', { count: remaining });
      pushToast(message, 'info', 1500);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('settingsHub.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 60 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Account & Identity */}
          <SettingsBlockSection title={t('settingsHub.accountIdentity')}>
            <SettingsBlockRow
              icon="person.text.rectangle"
              title={t('settingsHub.identityProfile')}
              onPress={() => { router.push('/settings/vc'); }}
            />
            <SettingsBlockRow
              icon="qrcode"
              title={t('settingsHub.solidarityQr')}
              onPress={() => { router.push('/settings/solidarity-qr'); }}
            />
            <SettingsBlockRow
              icon="key.horizontal"
              title={t('settingsHub.viewDids')}
              onPress={() => { router.push('/settings/dids'); }}
            />
          </SettingsBlockSection>

          {/* QR Sharing */}
          <SettingsBlockSection title={t('settingsHub.qrSharing')}>
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title={t('settingsHub.shareSettings')}
              onPress={() => { router.push('/settings/share-settings'); }}
            />
          </SettingsBlockSection>

          {/* Preferences — matches Swift v1.3.1: Security & Keys → Data & Sync → Advanced.
              Notifications/Language live under Advanced; Developer only after dev unlock. */}
          <SettingsBlockSection title={t('settingsHub.preferences')}>
            <SettingsBlockRow
              icon="lock.shield"
              title={t('settingsHub.securityKeys')}
              onPress={() => { router.push('/settings/security'); }}
            />
            <SettingsBlockRow
              icon={Platform.OS === 'ios' ? 'icloud' : 'arrow.counterclockwise.icloud'}
              title={t('settingsHub.dataSync')}
              onPress={() => { router.push('/settings/data-sync'); }}
            />
            <SettingsBlockRow
              icon="slider.horizontal.3"
              title={t('settingsHub.advanced')}
              onPress={() => { router.push('/settings/advanced'); }}
            />
            {developerMode ? (
              <SettingsBlockRow
                icon="hammer"
                title={t('settingsHub.developer')}
                onPress={() => { router.push('/settings/developer'); }}
              />
            ) : null}
          </SettingsBlockSection>

          {/* Guide */}
          <SettingsBlockSection title={t('settingsHub.guide')}>
            <SettingsBlockRow
              icon="arrow.counterclockwise"
              title={t('settingsHub.replayOnboarding')}
              onPress={() => { router.push('/onboarding?replay=1'); }}
            />
          </SettingsBlockSection>

          {/* About — Swift renders this inline with 12pt spacing (not 8) */}
          <View className="gap-3">
            <SettingsBlockSectionHeader title={t('settingsHub.about')} />
            <View className="px-4">
              <Pressable
                onPress={onVersionTap}
                accessibilityRole="button"
                accessibilityLabel={t('settingsHub.version')}
              >
                <SettingsBlockInfoRow
                  icon="info.circle"
                  title={t('settingsHub.version')}
                  value={version}
                />
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
