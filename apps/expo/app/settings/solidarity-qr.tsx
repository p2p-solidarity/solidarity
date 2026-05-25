/**
 * Solidarity QR — 1:1 port of
 * solidarity/Views/SettingsViews/SolidarityQRView.swift.
 *
 * Renders a single rounded card with:
 *   • "Solidarity QR" sub-headline (semibold, textPrimary)
 *   • Square QR area on a white background — generated through the same
 *     DID-signed-first, plaintext-fallback flow Swift's QRCodeManager uses.
 *   • Caption "Use this mode when both users are in Solidarity for direct
 *     exchange." centred under the QR.
 *
 * Expo does not yet persist Swift's `defaultSharingLevel` key, so this uses
 * Swift's default professional level. Field toggles mirror
 * ShareSettingsStore via `usePreferences`.
 */
import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyCard } from '@/cards/cardManager';
import {
  buildSolidarityQrPayloadAsync,
  type ShareFieldPreferences,
} from '@/cards/solidarityQrPayload';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import {
  didKeyForCurrentIdentity,
  publicJwk,
  signJwt,
} from '@/keychain/signingKey';
import { usePreferences } from '@/settings/preferences';

export default function SolidarityQrSettings() {
  const insets = useSafeAreaInsets();
  const card = useMyCard();
  const [payload, setPayload] = useState<string | null>(null);
  const shareTitle = usePreferences((s) => s.shareTitle);
  const shareCompany = usePreferences((s) => s.shareCompany);
  const shareEmail = usePreferences((s) => s.shareEmail);
  const sharePhone = usePreferences((s) => s.sharePhone);
  const shareProfileImage = usePreferences((s) => s.shareProfileImage);
  const shareSocialNetworks = usePreferences((s) => s.shareSocialNetworks);
  const shareSkills = usePreferences((s) => s.shareSkills);

  useEffect(() => {
    if (!card) {
      setPayload(null);
      return;
    }

    let cancelled = false;
    const shareFieldPreferences: ShareFieldPreferences = {
      shareTitle,
      shareCompany,
      shareEmail,
      sharePhone,
      shareProfileImage,
      shareSocialNetworks,
      shareSkills,
    };

    setPayload(null);
    void buildSettingsQrPayload(card, shareFieldPreferences).then((next) => {
      if (!cancelled) setPayload(next);
    });

    return () => {
      cancelled = true;
    };
  }, [
    card,
    shareCompany,
    shareEmail,
    sharePhone,
    shareProfileImage,
    shareSkills,
    shareSocialNetworks,
    shareTitle,
  ]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <Stack.Screen options={{ presentation: 'modal' }} />
      <SettingsBackToolbar title="Close" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Solidarity QR" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 + insets.bottom }}
      >
        <View className="px-4 gap-3">
          <View
            className="bg-cardBg rounded-xl"
            style={{
              padding: 12,
              borderWidth: 0.5,
              borderColor: Colors.divider,
            }}
          >
            <View className="items-center gap-3">
              <Text className="text-text1 text-[15px] font-semibold">
                Solidarity QR
              </Text>

              <View
                className="rounded-xl"
                style={{
                  backgroundColor: '#FFFFFF',
                  width: '100%',
                  aspectRatio: 1,
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 12,
                }}
              >
                {payload ? (
                  <QRCode
                    value={payload}
                    size={260}
                    backgroundColor="#FFFFFF"
                    color={Colors.text1}
                  />
                ) : (
                  <ActivityIndicator color={Colors.accentRose} />
                )}
              </View>

              <Text
                className="text-text2 text-[12px] text-center"
                style={{ paddingHorizontal: 8 }}
              >
                Use this mode when both users are in Solidarity for direct
                exchange.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

async function buildSettingsQrPayload(
  card: NonNullable<ReturnType<typeof useMyCard>>,
  shareFieldPreferences: ShareFieldPreferences
): Promise<string> {
  try {
    const [issuerDid, jwk] = await Promise.all([
      didKeyForCurrentIdentity(),
      publicJwk(),
    ]);
    return await buildSolidarityQrPayloadAsync(card, {
      sharingLevel: 'professional',
      shareFieldPreferences,
      signer: {
        issuerDid,
        publicKeyJwk: jwk,
        signJwt,
      },
    });
  } catch {
    return buildSolidarityQrPayloadAsync(card, {
      sharingLevel: 'professional',
      shareFieldPreferences,
    });
  }
}
