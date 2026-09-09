/**
 * v2 Settings hub. The public page is deliberately first because its username
 * is the account's shareable address. Protocol inspectors and credential tools
 * remain behind the five-tap Developer Options unlock.
 */
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { haptic } from '@/feedback/haptics';
import { pushToast } from '@/feedback/toast';
import { useTranslation } from '@/i18n';
import { publicPagePath } from '@/onboarding/publicPageUsername';
import { advanceDeveloperUnlock } from '@/settings/developerUnlock';
import { usePreferences } from '@/settings/preferences';

export default function SettingsHub() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const developerMode = usePreferences((s) => s.developerMode);
  const publicPageUsername = usePreferences((s) => s.publicPageUsername);
  const backupEnabled = usePreferences((s) => s.backupEnabled);
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
          <SettingsBlockSection title={t('settingsHub.publicPage')}>
            <SettingsBlockRow
              icon="at"
              title={t('settingsHub.myUsername')}
              subtitle={publicPageUsername
                ? publicPagePath(publicPageUsername)
                : t('settingsHub.usernamePrompt')}
              onPress={() => { router.push('/settings/username'); }}
            />
          </SettingsBlockSection>

          {/* Account */}
          <SettingsBlockSection title={t('settingsHub.accountIdentity')}>
            <SettingsBlockRow
              icon="person.text.rectangle"
              title={t('settingsHub.identityProfile')}
              onPress={() => { router.push('/me/edit'); }}
            />
            <SettingsBlockRow
              icon="lock.shield"
              title={t('settingsHub.accountProtection')}
              onPress={() => { router.push('/settings/security'); }}
            />
            <SettingsBlockRow
              icon="icloud"
              title={t('settingsHub.identityExport')}
              onPress={() => { router.push('/settings/backup'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('settingsHub.plan')}>
            <SettingsBlockRow
              icon="sparkles"
              title={t('settingsHub.plan')}
              onPress={() => { router.push('/settings/pro'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('settingsHub.preferences')}>
            <SettingsBlockRow
              icon="paintbrush"
              title={t('settingsHub.appearance')}
              onPress={() => { router.push('/settings/appearance'); }}
            />
            <SettingsBlockRow
              icon="globe"
              title={t('settingsHub.language')}
              onPress={() => { router.push('/settings/language'); }}
            />
            <SettingsBlockRow
              icon="bell"
              title={t('settingsHub.notifications')}
              onPress={() => { router.push('/settings/notifications'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('settingsHub.data')}>
            <SettingsBlockRow
              icon="square.and.arrow.up"
              title={t('settingsHub.exportContacts')}
              subtitle={t('settingsHub.exportContactsSubtitle')}
              onPress={() => {
                router.push({ pathname: '/(tabs)/people', params: { edit: '1' } });
              }}
            />
            <SettingsBlockRow
              icon="square.and.arrow.down"
              title={t('settingsHub.importContacts')}
              onPress={() => { router.push('/contacts/import-vcf'); }}
            />
            <SettingsBlockRow
              icon="icloud"
              title={t('settingsHub.cloudBackup')}
              trailingText={backupEnabled ? t('common.on') : t('common.off')}
              onPress={() => { router.push('/settings/data-sync'); }}
            />
          </SettingsBlockSection>

          <SettingsBlockSection title={t('settingsHub.advancedSection')}>
            {developerMode ? (
              <SettingsBlockRow
                icon="hammer"
                title={t('developer.title')}
                subtitle={t('settingsHub.developerSubtitle')}
                onPress={() => { router.push('/settings/developer'); }}
              />
            ) : null}
            <SettingsBlockRow
              icon="arrow.counterclockwise"
              title={t('settingsHub.advanced')}
              subtitle={t('settingsHub.advancedSubtitle')}
              onPress={() => { router.push('/settings/advanced'); }}
            />
          </SettingsBlockSection>

          <View className="gap-3">
            <SettingsBlockSectionHeader title={t('settingsHub.about')} />
            <View className="px-4 gap-2">
              <SettingsBlockRow
                icon="arrow.counterclockwise"
                title={t('settingsHub.replayOnboarding')}
                onPress={() => { router.push('/onboarding?replay=1'); }}
              />
              <SettingsBlockRow
                icon="hand.raised"
                title={t('settingsHub.privacy')}
                onPress={() => { router.push('/settings/privacy'); }}
              />
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
