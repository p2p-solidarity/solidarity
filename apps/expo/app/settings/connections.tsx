import { router, useFocusEffect } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
import { useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  SettingsBlockInfoRow,
  SettingsBlockRow,
  SettingsBlockSection,
  SettingsBlockToggleRow,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { useTranslation } from '@/i18n';
import { makeKind0Fetcher } from '@/nostr/fetchKind0';
import { DEFAULT_RELAYS } from '@/nostr/publish';
import { stopLaneManager } from '@/pear/laneManager';
import { useProfileStore } from '@/profile/store';
import { usePreferences } from '@/settings/preferences';
import { verifyNostrBinding, type VerifyNostrBindingResult } from '@solidarity/shared';

export default function ConnectionsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const record = useProfileStore((state) => state.record);
  const autoRepublish = usePreferences((state) => state.nostrAutoRepublish);
  const pearEnabled = usePreferences((state) => state.pearExchangeEnabled);
  const setPreference = usePreferences((state) => state.set);
  const npubClaim =
    record?.alsoKnownAs.find((alias) => alias.startsWith('nostr:npub'))?.slice('nostr:'.length) ??
    null;
  const [nostrVerification, setNostrVerification] = useState<VerifyNostrBindingResult | null>(null);
  const [nostrChecking, setNostrChecking] = useState(npubClaim !== null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!record || !npubClaim) {
        setNostrVerification(null);
        setNostrChecking(false);
        return () => {
          cancelled = true;
        };
      }
      setNostrChecking(true);
      void verifyNostrBinding(record, makeKind0Fetcher(DEFAULT_RELAYS)).then((result) => {
        if (cancelled) return;
        setNostrVerification(result);
        setNostrChecking(false);
      });
      return () => {
        cancelled = true;
      };
    }, [npubClaim, record]),
  );

  const isPublished =
    nostrVerification?.npub === npubClaim && nostrVerification.state === 'verified';
  const publicationStatus =
    npubClaim === null
      ? t('connectionsSettings.localOnly')
      : nostrChecking
        ? t('connectionsSettings.checking')
        : isPublished
          ? t('connectionsSettings.published')
          : t('connectionsSettings.configured');

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsScreenTitle
        title={t('connectionsSettings.title')}
        leadingAction={{
          accessibilityLabel: t('settingsHub.title'),
          onPress: () => {
            safeBack('/settings');
          },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 20, paddingBottom: insets.bottom + 48, gap: 24 }}>
        <SettingsBlockSection
          title={t('connectionsSettings.publicTitle')}
          footer={t('connectionsSettings.publicFooter')}>
          <SettingsBlockInfoRow
            icon={isPublished ? 'checkmark.seal.fill' : npubClaim ? 'checkmark.seal' : 'eye.slash'}
            title={t('connectionsSettings.publicStatus')}
            value={publicationStatus}
          />
          <SettingsBlockRow
            icon="antenna.radiowaves.left.and.right"
            title={
              npubClaim
                ? t('connectionsSettings.republish')
                : t('connectionsSettings.publish')
            }
            subtitle={t('connectionsSettings.publishSubtitle')}
            onPress={() => {
              router.push('/verify/nostr');
            }}
          />
          <SettingsBlockToggleRow
            icon="arrow.triangle.2.circlepath"
            title={t('connectionsSettings.autoRepublish')}
            subtitle={t('connectionsSettings.autoRepublishSubtitle')}
            value={autoRepublish}
            onValueChange={(next) => {
              setPreference('nostrAutoRepublish', next);
            }}
          />
        </SettingsBlockSection>

        <SettingsBlockSection
          title={t('connectionsSettings.privateTitle')}
          footer={t('connectionsSettings.privateFooter')}>
          <SettingsBlockToggleRow
            icon="person.2"
            title={t('connectionsSettings.pearExchange')}
            subtitle={t('connectionsSettings.pearExchangeSubtitle')}
            value={pearEnabled}
            onValueChange={(next) => {
              if (!next) stopLaneManager();
              setPreference('pearExchangeEnabled', next);
            }}
          />
        </SettingsBlockSection>
      </ScrollView>
    </View>
  );
}
