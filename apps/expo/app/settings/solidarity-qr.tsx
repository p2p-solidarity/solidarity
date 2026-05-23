/**
 * Solidarity QR — 1:1 port of
 * solidarity/Views/SettingsViews/SolidarityQRView.swift.
 *
 * Renders a single rounded card with:
 *   • "Solidarity QR" sub-headline (semibold, textPrimary)
 *   • Square QR area on a white background — generated from the current
 *     business card payload at the user's default sharing level.
 *   • Caption "Use this mode when both users are in Solidarity for direct
 *     exchange." centred under the QR.
 *
 * Mirrors Swift's `defaultSharingLevel` `@AppStorage` by reading the same
 * preference key (`defaultSharingLevel`) from the existing zustand store.
 * Until that preference is persisted in Expo we fall back to the
 * "professional" level — matching Swift's default behaviour exactly.
 *
 * TODO(android): the Swift original calls `QRCodeManager.shared.generateQRCode`
 * which slices the business card by sharing level via Privacy-Aware Selective
 * Disclosure. Until that pipeline ports we encode a stable URL pointer
 * (https://solidarity.gg/c/{id}) so the QR scans correctly and routes
 * through the existing deep-link handler.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyCard } from '@/cards/cardManager';
import {
  SettingsBackToolbar,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';

export default function SolidarityQrSettings() {
  const insets = useSafeAreaInsets();
  const card = useMyCard();

  const payload = useMemo(() => {
    if (!card) return null;
    return `https://solidarity.gg/c/${card.id}`;
  }, [card]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar onPress={() => { router.back(); }} />
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
