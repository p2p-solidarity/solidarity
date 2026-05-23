/**
 * Shoutouts list — mirrors Swift ShoutoutView. Renders the encrypted
 * messaging gallery (incoming + outgoing Sakura messages).
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useShoutoutStore } from '@/shoutouts/store';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function ShoutoutsHub() {
  const items = useShoutoutStore((s) => s.items);
  const hydrate = useShoutoutStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="flex-row items-center justify-between px-4 pt-6">
        <ThemedText variant="headlineLarge">Sakura</ThemedText>
        <ThemedButton
          label="Compose"
          size="sm"
          onPress={() => { router.push('/shoutouts/new'); }}
        />
      </View>

      {items.length === 0 ? (
        <ThemedSurface variant="outlined" padded className="mx-4 mt-6">
          <ThemedText variant="titleMedium">No messages yet</ThemedText>
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
            End-to-end encrypted Sakura messages will show up here.
          </ThemedText>
        </ThemedSurface>
      ) : (
        items.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => { router.push({ pathname: '/shoutouts/[id]', params: { id: s.id } }); }}
            accessibilityRole="button"
            accessibilityLabel={`Open shoutout ${s.subject}`}
          >
            <ThemedSurface variant="card" padded className="mx-4 mt-2">
              <ThemedText variant="caption" tone="tertiary">
                {s.direction === 'incoming' ? '↘ FROM' : '↗ TO'} ·{' '}
                {s.createdAt.toLocaleDateString()}
              </ThemedText>
              <ThemedText variant="titleMedium" className="mt-1">
                {s.counterpartName}
              </ThemedText>
              <ThemedText variant="bodyMedium" numberOfLines={2} className="mt-1">
                {s.subject}
              </ThemedText>
            </ThemedSurface>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
