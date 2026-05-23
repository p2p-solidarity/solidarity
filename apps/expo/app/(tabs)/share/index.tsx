/**
 * Share tab — mirrors Swift SharingTabView. Shows the user's QR (top half)
 * + a radar visualisation while browsing for nearby peers (bottom half).
 *
 * QR rendering: react-native-qrcode-svg. The encoded payload is a
 * sharing URL containing a base64url of the user's signed card snapshot
 * (the actual encoding lands when Phase 4.1's share-link service does).
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
  const [browsing, setBrowsing] = useState(false);

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
        {browsing ? (
          <View className="items-center">
            <ThemedText variant="caption" tone="tertiary">SEARCHING…</ThemedText>
            <View className="my-4">
              <RadarMatching avatar="📡" />
            </View>
          </View>
        ) : null}
        <ThemedButton
          label={browsing ? 'Stop searching' : 'Find nearby'}
          fullWidth
          onPress={() => { setBrowsing((b) => !b); }}
        />
        <View className="mt-3">
          <ThemedButton
            variant="secondary"
            label="Scan a QR instead"
            fullWidth
            onPress={() => { router.push('/scan'); }}
          />
        </View>
      </ThemedSurface>
    </ScrollView>
  );
}
