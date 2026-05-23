/**
 * People tab — mirrors Swift PeopleListView.
 * Placeholder; full FlashList + contact-row port lands in Phase 5c.
 */
import { View } from 'react-native';

import { ThemedSurface, ThemedText } from '@/components/themed';

export default function PeopleTab() {
  return (
    <View className="flex-1 bg-pageBg p-4">
      <ThemedText variant="headlineLarge">People</ThemedText>
      <ThemedText variant="bodyMedium" tone="secondary" className="mt-2">
        Contacts ported from Swift PeopleListView land here.
      </ThemedText>
      <ThemedSurface variant="card" padded className="mt-6">
        <ThemedText variant="titleMedium">No contacts yet</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Scan a QR or accept a proximity invite to add one.
        </ThemedText>
      </ThemedSurface>
    </View>
  );
}
