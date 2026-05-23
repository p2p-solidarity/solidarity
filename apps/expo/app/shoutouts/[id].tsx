/**
 * Shoutout detail — mirrors Swift ShoutoutDetailView.
 * Renders a single decrypted Sakura message + reply / delete actions.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { Alert, ScrollView, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useShoutoutStore } from '@/shoutouts/store';

export default function ShoutoutDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const items = useShoutoutStore((s) => s.items);
  const remove = useShoutoutStore((s) => s.remove);
  const item = items.find((s) => s.id === id);

  if (!item) {
    return (
      <View className="flex-1 bg-pageBg items-center justify-center p-6">
        <ThemedText tone="secondary">Message not found.</ThemedText>
      </View>
    );
  }

  const confirmDelete = () => {
    Alert.alert('Delete message', 'Removed from local cache (cloud copy is unaffected).', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void remove(item.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6">
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => { router.back(); }} />
      </View>
      <View className="px-4 mt-4">
        <ThemedText variant="caption" tone="tertiary">
          {item.direction === 'incoming' ? '↘ FROM' : '↗ TO'} ·{' '}
          {item.createdAt.toLocaleString()}
        </ThemedText>
        <ThemedText variant="headlineLarge" className="mt-1">
          {item.counterpartName}
        </ThemedText>
        <ThemedText variant="titleMedium" tone="secondary" className="mt-1">
          {item.subject}
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4 mt-4 mb-6">
        <ThemedText variant="bodyLarge" selectable>
          {item.body}
        </ThemedText>
      </ThemedSurface>

      <View className="px-4 mb-10">
        <ThemedButton variant="destructive" label="Delete" fullWidth onPress={confirmDelete} />
      </View>
    </ScrollView>
  );
}
