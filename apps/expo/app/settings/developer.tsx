/**
 * Developer settings — gates dev-only tools and inlines the DID-first
 * extension playground (formerly app/settings/dev-sandbox.tsx).
 *
 * HARD SCOPE (docs/dev-sandbox-identity-graph.md line 1):
 *   Every Lab on this screen lives behind `usePreferences.developerMode`.
 *   The v1.3.1 public surface is frozen by Swift parity. Promotion to
 *   public goes through the graduation criteria in docs §11.
 */
import { router } from 'expo-router';
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
import { useTranslation } from '@/i18n';
import { usePreferences } from '@/settings/preferences';

export default function DeveloperSettings() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const setPref = usePreferences((s) => s.set);
  const reset = usePreferences((s) => s.reset);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('developer.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          <View className="px-4">
            <Text className="text-text2 text-[13px]">
              {t('developer.warning')}
            </Text>
          </View>

          <SettingsBlockSection
            title={t('developer.mode.header')}
            footer={developerMode
              ? t('developer.mode.footerOn')
              : t('developer.mode.footerOff')}
          >
            <SettingsBlockToggleRow
              icon="hammer"
              title={t('developer.mode.toggle')}
              value={developerMode}
              onValueChange={(v) => { setPref('developerMode', v); }}
            />
          </SettingsBlockSection>

          {developerMode ? (
            <>
              <SettingsBlockSection
                title={t('developer.p2p.header')}
                footer={t('developer.p2p.footer')}
              >
                <SettingsBlockRow
                  icon="dot.radiowaves.left.and.right"
                  title={t('developer.p2p.labTitle')}
                  subtitle={t('developer.p2p.labSubtitle')}
                  onPress={() => { router.push('/dev/p2p'); }}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title={t('developer.identity.header')}
                footer={t('developer.identity.footer')}
              >
                <SettingsBlockRow
                  icon="person.text.rectangle"
                  title={t('developer.identity.treeTitle')}
                  subtitle={t('developer.identity.treeSubtitle')}
                  onPress={() => { router.push('/dev/identity-tree'); }}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title={t('developer.dag.header')}
                footer={t('developer.dag.footer')}
              >
                <SettingsBlockRow
                  icon="square.and.arrow.up"
                  title={t('developer.dag.labTitle')}
                  subtitle={t('developer.dag.labSubtitle')}
                  onPress={() => { router.push('/dev/dag'); }}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title={t('developer.nostr.header')}
                footer={t('developer.nostr.footer')}
              >
                <SettingsBlockRow
                  icon="arrow.triangle.2.circlepath"
                  title={t('developer.nostr.labTitle')}
                  subtitle={t('developer.nostr.labSubtitle')}
                  onPress={() => { router.push('/dev/nostr'); }}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title={t('developer.socialGraph.header')}
                footer={t('developer.socialGraph.footer')}
              >
                <SettingsBlockRow
                  icon="qrcode"
                  title={t('developer.socialGraph.commonFriendsTitle')}
                  subtitle={t('developer.socialGraph.commonFriendsSubtitle')}
                  onPress={() => { router.push('/dev/common-friends'); }}
                />
              </SettingsBlockSection>

              <SettingsBlockSection
                title={t('developer.pear.header')}
                footer={t('developer.pear.footer')}
              >
                <SettingsBlockRow
                  icon="waveform"
                  title={t('developer.pear.labTitle')}
                  subtitle={t('developer.pear.labSubtitle')}
                  onPress={() => { router.push('/dev/pear-echo'); }}
                />
                <SettingsBlockRow
                  icon="dot.radiowaves.left.and.right"
                  title={t('developer.pear.laneLabTitle')}
                  subtitle={t('developer.pear.laneLabSubtitle')}
                  onPress={() => { router.push('/dev/pear-lane'); }}
                />
              </SettingsBlockSection>

              <View className="gap-3">
                <SettingsBlockSectionHeader title={t('developer.dangerZone.header')} />
                <View className="px-4 gap-2">
                  <SettingsBlockDangerRow
                    icon="arrow.counterclockwise"
                    title={t('developer.dangerZone.resetTitle')}
                    subtitle={t('developer.dangerZone.resetSubtitle')}
                    onPress={() => { reset(); }}
                  />
                </View>
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
