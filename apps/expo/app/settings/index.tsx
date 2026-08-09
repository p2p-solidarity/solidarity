/**
 * Settings hub — 1:1 port of solidarity/Views/SettingsViews/SettingsView.swift.
 *
 * Blocks: Account, Preferences, Card, Guide, About. Protocol inspectors and
 * credential tools live exclusively inside Developer Options.
 * Each row is a SettingsBlockRow on a `mutedSurface` 12pt card, stacked
 * 8pt apart. Sections themselves are 24pt apart. About section is rendered
 * inline (no SettingsBlockSection wrapper, since the version row uses the
 * Info-row variant + 14pt header + 12pt spacing).
 */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useRef } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { advanceDeveloperUnlock } from '@/settings/developerUnlock';
import { usePreferences } from '@/settings/preferences';

export default function SettingsHub() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const setPref = usePreferences((s) => s.set);
  const tapCountRef = useRef(0);

  const version = Constants.expoConfig?.version ?? 'Unknown';

  // The counter is deliberately component-local; only the enabled preference
  // persists. Taps one and two stay silent so this remains a hidden entry.
  const onVersionTap = () => {
    const transition = advanceDeveloperUnlock(tapCountRef.current, developerMode);
    tapCountRef.current = transition.nextTapCount;

    if (transition.effect.kind === 'enabled') {
      setPref('developerMode', true);
      haptic('success');
      pushToast(t('settingsHub.devUnlock.enabled'), 'success', 3000);
    } else if (transition.effect.kind === 'countdown') {
      const countdownKey = transition.effect.remaining === 1
        ? 'settingsHub.devUnlock.remainingOne'
        : 'settingsHub.devUnlock.remainingMany';
      pushToast(
        t(countdownKey, { count: transition.effect.remaining }),
        'info',
        1500,
      );
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsScreenTitle
        title={t('settingsHub.title')}
        leadingAction={{
          accessibilityLabel: 'Back',
          onPress: () => { safeBack(); },
        }}
      />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 60 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Account */}
          <SettingsBlockSection title={t('settingsHub.accountIdentity')}>
            <SettingsBlockRow
              icon="person.text.rectangle"
              title={t('settingsHub.identityProfile')}
              onPress={() => { router.push('/me/edit'); }}
            />
            <SettingsBlockRow
              icon="arrow.up.arrow.down.square"
              title={t('settingsHub.identityExport')}
              onPress={() => { router.push('/settings/backup'); }}
            />
          </SettingsBlockSection>

          {/* Plan — one honest entry for the free/Pro boundary and web management. */}
          <SettingsBlockSection title={t('settingsHub.plan')}>
            <SettingsBlockRow
              icon="sparkles"
              title={t('settingsHub.plan')}
              onPress={() => { router.push('/settings/pro'); }}
            />
          </SettingsBlockSection>

          {/* Preferences — matches Swift v1.3.1: Security & Keys → Data & Sync → Advanced.
              Notifications/Language live under Advanced; Developer only after dev unlock. */}
          <SettingsBlockSection title={t('settingsHub.preferences')}>
            <SettingsBlockRow
              icon="antenna.radiowaves.left.and.right"
              title={t('settingsHub.connectionsPublishing')}
              onPress={() => { router.push('/settings/connections'); }}
            />
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
          </SettingsBlockSection>

          {/* Card sharing keeps the existing working QR path secondary. */}
          <SettingsBlockSection
            title={t('legacyCard.section')}
            footer={t('legacyCard.sectionFooter')}
          >
            <SettingsBlockRow
              icon="qrcode"
              title={t('legacyCard.qrAndFields')}
              subtitle={t('legacyCard.rowSubtitle')}
              onPress={() => { router.push('/settings/share-settings'); }}
            />
          </SettingsBlockSection>

          {/* Guide — Figma 758:4610 renders Replay Onboarding in the rose accent
              (icon + title), the one accented row in the hub. */}
          <SettingsBlockSection title={t('settingsHub.guide')}>
            <SettingsBlockRow
              icon="arrow.counterclockwise"
              title={t('settingsHub.replayOnboarding')}
              iconColor={Colors.accentRose}
              titleColor={Colors.accentRose}
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
