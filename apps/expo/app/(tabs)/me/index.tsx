/**
 * Me tab — mirrors Swift MeTabView.
 * Placeholder; identity dashboard / passport flow / credential list land
 * in Phases 7 + 8.
 */
import { View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function MeTab() {
  return (
    <View className="flex-1 bg-pageBg p-4">
      <ThemedText variant="headlineLarge">Me</ThemedText>
      <ThemedText variant="bodyMedium" tone="secondary" className="mt-2">
        Your identity card + verifiable credentials.
      </ThemedText>
      <ThemedSurface variant="card" padded className="mt-6">
        <ThemedText variant="titleMedium">Personal card</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Not yet created.
        </ThemedText>
        <View className="mt-3">
          <ThemedButton label="Create card" onPress={() => undefined} />
        </View>
      </ThemedSurface>
    </View>
  );
}
