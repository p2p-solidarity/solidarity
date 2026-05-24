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
import { ScrollView, Text, View } from 'react-native';
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
import { useActiveDid, useIdentityCoordinator } from '@/identity';

export default function DIDListSheet() {
  const insets = useSafeAreaInsets();
  const seedKeychain = useIdentityCoordinator((s) => s.seedFromKeychain);
  useEffect(() => {
    void seedKeychain();
  }, [seedKeychain]);
  const activeDid = useActiveDid();

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Your DIDs" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 24, paddingBottom: 24 + insets.bottom }}
      >
        <View className="gap-6">
          {/* Active DID */}
          <View className="gap-2">
            <SettingsBlockSectionHeader title="Active DID" />
            <View className="px-4">
              {activeDid ? <DidCard did={activeDid} /> : <NoActiveDidCard />}
            </View>
          </View>

          {/* Key Storage */}
          <SettingsBlockSection
            title="Key Storage"
            footer="DID keys are stored in iCloud Keychain and shared across your signed-in devices."
          >
            <SettingsBlockInfoRow
              icon="key.icloud"
              title="Storage"
              value="iCloud Keychain"
            />
            <SettingsBlockInfoRow
              icon="arrow.triangle.2.circlepath"
              title="Sync"
              value="Same Apple ID devices"
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

function NoActiveDidCard() {
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
      <Text className="text-text2 text-[15px] flex-1">No active DID</Text>
    </View>
  );
}
