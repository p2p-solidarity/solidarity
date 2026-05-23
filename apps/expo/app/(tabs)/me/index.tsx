/**
 * Me tab — mirrors Swift MeTabView. Shows the user's own card or a CTA
 * to create one, plus quick-access to settings + the passport flow.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';

import { useCardStore, useMyCard } from '@/cards/cardManager';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function MeTab() {
  const card = useMyCard();
  const hydrate = useCardStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="flex-row items-center justify-between px-4 pt-6">
        <ThemedText variant="headlineLarge">Me</ThemedText>
        <ThemedButton
          variant="secondary"
          size="sm"
          label="Settings"
          onPress={() => router.push('/settings')}
        />
      </View>

      <ThemedSurface variant="card" padded className="mx-4 mt-6">
        {card ? (
          <View>
            <ThemedText variant="caption" tone="tertiary">PERSONAL CARD</ThemedText>
            <ThemedText variant="titleLarge" className="mt-1">{card.name}</ThemedText>
            {card.title ? (
              <ThemedText variant="bodyMedium" tone="secondary">
                {card.title}
                {card.company ? ` · ${card.company}` : ''}
              </ThemedText>
            ) : null}
            {card.email ? (
              <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
                {card.email}
              </ThemedText>
            ) : null}
            <View className="mt-4 flex-row">
              <ThemedButton
                label="Edit"
                size="sm"
                onPress={() => router.push({ pathname: '/cards/edit', params: { id: card.id } })}
              />
            </View>
          </View>
        ) : (
          <View>
            <ThemedText variant="titleMedium">No personal card yet</ThemedText>
            <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
              Add one so others can save your contact info from a QR.
            </ThemedText>
            <View className="mt-3">
              <ThemedButton
                label="Create card"
                onPress={() => router.push('/cards/edit')}
              />
            </View>
          </View>
        )}
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-4 mb-10">
        <ThemedText variant="titleMedium">Passport credential</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Verify your identity once via passport NFC + ZK proof.
        </ThemedText>
        <View className="mt-3">
          <ThemedButton
            variant="secondary"
            label="Start passport flow"
            onPress={() => router.push('/passport')}
          />
        </View>
      </ThemedSurface>
    </ScrollView>
  );
}
