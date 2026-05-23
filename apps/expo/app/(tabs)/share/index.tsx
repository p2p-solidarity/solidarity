/**
 * Share tab — mirrors Swift SharingTabView. 1:1 strings:
 *   navigation title: "Share"
 *   matching toggle:  "Ready To Match" / "Scanning Nearby"
 *   action button:    "Start Matching" / "Stop Matching"
 *   browsing copy:    "Searching for nearby peers…"
 *   idle copy:        "Start matching to discover nearby people."
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';

import { useMyCard } from '@/cards/cardManager';
import { RadarMatching } from '@/components/share/RadarMatching';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function ShareTab() {
  const myCard = useMyCard();
  const [isMatching, setIsMatching] = useState(false);

  const shareUrl = myCard
    ? `https://solidarity.gg/c/${myCard.id}`
    : 'https://solidarity.gg';

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Share</ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4 items-center">
        {myCard ? (
          <View className="items-center">
            <QRCode value={shareUrl} size={200} backgroundColor="transparent" />
            <ThemedText variant="caption" tone="tertiary" className="mt-3">
              {myCard.name}
            </ThemedText>
          </View>
        ) : (
          <View className="items-center">
            <ThemedText variant="titleMedium">No card yet</ThemedText>
            <ThemedText variant="bodySmall" tone="tertiary" className="mt-1 text-center">
              Create your card on the Me tab before sharing.
            </ThemedText>
          </View>
        )}
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-4">
        <ThemedText variant="titleMedium" className="text-center">
          {isMatching ? 'Scanning Nearby' : 'Ready To Match'}
        </ThemedText>
        {isMatching ? (
          <View className="items-center mt-3">
            <View className="my-2">
              <RadarMatching avatar="📡" />
            </View>
            <ThemedText variant="bodySmall" tone="tertiary" className="text-center">
              Searching for nearby peers…
            </ThemedText>
          </View>
        ) : (
          <ThemedText variant="bodySmall" tone="tertiary" className="text-center mt-2">
            Start matching to discover nearby people.
          </ThemedText>
        )}
        <View className="mt-4">
          <ThemedButton
            label={isMatching ? 'Stop Matching' : 'Start Matching'}
            variant={isMatching ? 'destructive' : 'primary'}
            fullWidth
            onPress={() => { setIsMatching((b) => !b); }}
          />
        </View>
        <View className="mt-3">
          <ThemedButton
            variant="secondary"
            label="Scan QR"
            fullWidth
            onPress={() => { router.push('/scan'); }}
          />
        </View>
      </ThemedSurface>
    </ScrollView>
  );
}
