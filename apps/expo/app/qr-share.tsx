/**
 * Solidarity QR — full-screen sheet. Mirrors Swift SolidarityQRView.
 * Renders the user's personal QR at full bleed so it's easy to scan
 * across a table. Tapping the close button or swiping down dismisses.
 */
import { router } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useMyCard } from '@/cards/cardManager';
import { Wordmark } from '@/components/brand/Wordmark';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';

export default function SolidarityQrSheet() {
  const myCard = useMyCard();

  const payload = useMemo(
    () =>
      myCard
        ? `https://solidarity.gg/c/${myCard.id}`
        : 'https://solidarity.gg',
    [myCard]
  );

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6 flex-row items-center justify-between">
        <Wordmark width={140} height={22} />
        <ThemedButton
          variant="secondary"
          size="sm"
          label="Close"
          onPress={() => { router.back(); }}
        />
      </View>

      <View className="items-center mt-10">
        <ThemedSurface variant="elevated" padded className="items-center">
          <QRCode
            value={payload}
            size={280}
            backgroundColor="transparent"
            color={Colors.text1}
          />
        </ThemedSurface>
        <ThemedText variant="titleLarge" className="mt-5">
          {myCard?.name ?? 'User Node'}
        </ThemedText>
        {myCard?.email ? (
          <ThemedText variant="bodyMedium" tone="secondary" className="mt-1">
            {myCard.email}
          </ThemedText>
        ) : null}
      </View>
    </ScrollView>
  );
}
