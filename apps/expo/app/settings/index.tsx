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
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { usePreferences } from '@/settings/preferences';

export default function SettingsHub() {
  const insets = useSafeAreaInsets();
  const developerMode = usePreferences((s) => s.developerMode);

  const version = Constants.expoConfig?.version ?? 'Unknown';

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Settings" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 60 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Account & Identity */}
          <SettingsBlockSection title="Account & Identity">
            <SettingsBlockRow
              icon="person.text.rectangle"
              title="Identity Profile"
              onPress={() => { router.push('/settings/vc'); }}
            />
            <SettingsBlockRow
              icon="qrcode"
              title="Solidarity QR"
              onPress={() => { router.push('/settings/solidarity-qr'); }}
            />
            <SettingsBlockRow
              icon="key.horizontal"
              title="View DIDs"
              onPress={() => { router.push('/settings/security'); }}
            />
          </SettingsBlockSection>

          {/* QR Sharing */}
          <SettingsBlockSection title="QR Sharing">
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title="Share Settings"
              onPress={() => { router.push('/settings/privacy'); }}
            />
          </SettingsBlockSection>

          {/* Preferences */}
          <SettingsBlockSection title="Preferences">
            <SettingsBlockRow
              icon="lock.shield"
              title="Security & Keys"
              onPress={() => { router.push('/settings/security'); }}
            />
            <SettingsBlockRow
              icon="icloud"
              title="Data & Sync"
              onPress={() => { router.push('/settings/data-sync'); }}
            />
            <SettingsBlockRow
              icon="slider.horizontal.3"
              title="Advanced"
              onPress={() => { router.push('/settings/advanced'); }}
            />
            <SettingsBlockRow
              icon="bell"
              title="Notifications"
              onPress={() => { router.push('/settings/notifications'); }}
            />
            {developerMode ? (
              <SettingsBlockRow
                icon="hammer"
                title="Developer"
                onPress={() => { router.push('/settings/developer'); }}
              />
            ) : null}
          </SettingsBlockSection>

          {/* Guide */}
          <SettingsBlockSection title="Guide">
            <SettingsBlockRow
              icon="arrow.counterclockwise"
              title="Replay Onboarding"
              onPress={() => { router.push('/onboarding'); }}
            />
          </SettingsBlockSection>

          {/* About — Swift renders this inline with 12pt spacing (not 8) */}
          <View className="gap-3">
            <SettingsBlockSectionHeader title="About" />
            <View className="px-4">
              <SettingsBlockInfoRow
                icon="info.circle"
                title="Version"
                value={version}
              />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
