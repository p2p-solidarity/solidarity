/**
 * View DIDs — 1:1 port of the private DIDListSheet inside
 * solidarity/Views/SettingsViews/SettingsView.swift (lines 138-212).
 *
 * Layout:
 *   • SettingsBackToolbar + screen title "Your DIDs"
 *   • Active DID card (header + did:* method label + truncated DID body)
 *   • Key Storage block:
 *       – Storage = iCloud Keychain
 *       – Sync    = Same Apple ID devices
 *   • Footer hint identical to Swift copy.
 *
 * Active DID source: `useIdentityCoordinator.profile.activeDID.did`, seeded
 * once from the SpruceID-managed signing key. Derivation reads the public
 * JWK only (no biometric prompt) so the card paints frame 1 with the cached
 * value when available, mirroring Swift's `IdentityCoordinator.loadIdentity`
 * cached-descriptor fallback. Falls back to "No active DID" until the seed
 * resolves or on keychain errors.
 */
import { router, Stack } from 'expo-router';
import { useEffect } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockInfoRow,
  SettingsBlockSection,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useTranslation } from '@/i18n';
import { useActiveDid, useIdentityCoordinator } from '@/identity';

export default function DIDListSheet() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  useEffect(() => {
    void seedKeychain();
  }, [seedKeychain]);
  const activeDid = useActiveDid();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <SettingsBackToolbar title={t('dids.close')} onPress={() => { router.back(); }} />
      <SettingsScreenTitle title={t('dids.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Active DID */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title={t('dids.activeDid')} />
            <View className="px-4">
              {activeDid ? <DidCard did={activeDid} /> : <NoActiveDidCard label={t('dids.noActiveDid')} />}
            </View>
          </View>

          {/* Key Storage — platform-specific labels */}
          <SettingsBlockSection
            title={t('dids.keyStorage')}
            footer={
              Platform.OS === 'ios'
                ? t('dids.keyStorageFooter.ios')
                : t('dids.keyStorageFooter.android')
            }
          >
            <SettingsBlockInfoRow
              icon={Platform.OS === 'ios' ? 'key.icloud' : 'lock.shield'}
              title={t('dids.storage')}
              value={Platform.OS === 'ios' ? t('dids.storageValue.ios') : t('dids.storageValue.android')}
            />
            <SettingsBlockInfoRow
              icon="arrow.triangle.2.circlepath"
              title={t('dids.sync')}
              value={Platform.OS === 'ios' ? t('dids.syncValue.ios') : t('dids.syncValue.android')}
            />
          </SettingsBlockSection>
        </View>
      </ScrollView>
    </View>
  );
}

function DidCard({ did }: { did: string }) {
  const method = did.startsWith('did:key') ? 'did:key' : 'did:web';
  return (
    <View
      className="bg-mutedSurface rounded-xl"
      style={{ paddingHorizontal: 14, paddingVertical: 12 }}
    >
      <View className="flex-row items-center" style={{ marginBottom: 8 }}>
        <View
          style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <SfIcon name="key.horizontal" size={14} color={Colors.text1} />
        </View>
        <Text
          className="text-text2 text-[13px] font-semibold"
          style={{ fontFamily: 'Menlo' }}
        >
          {method.toUpperCase()}
        </Text>
      </View>
      <Text
        className="text-text1 text-[12px]"
        style={{ fontFamily: 'Menlo' }}
        numberOfLines={3}
        selectable
      >
        {did}
      </Text>
    </View>
  );
}

function NoActiveDidCard({ label }: { label: string }) {
  return (
    <View
      className="bg-mutedSurface rounded-xl flex-row items-center"
      style={{ paddingHorizontal: 14, paddingVertical: 14 }}
    >
      <View
        style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <SfIcon name="circle.dashed" size={14} color={Colors.text2} />
      </View>
      <Text className="text-text2 text-[15px] flex-1">{label}</Text>
    </View>
  );
}
