/**
 * Share tab — mirrors Swift SharingTabView.
 * Placeholder; radar + QR sharing + proximity matching land in Phase 6.
 */
import { View } from 'react-native';

import { ThemedButton, ThemedText } from '@/components/themed';

export default function ShareTab() {
  return (
    <View className="flex-1 bg-pageBg p-4">
      <ThemedText variant="headlineLarge">Share</ThemedText>
      <ThemedText variant="bodyMedium" tone="secondary" className="mt-2">
        Show QR + start proximity matching here.
      </ThemedText>
      <View className="mt-6">
        <ThemedButton label="Show my QR" fullWidth onPress={() => undefined} />
      </View>
      <View className="mt-3">
        <ThemedButton
          variant="secondary"
          label="Find nearby"
          fullWidth
          onPress={() => undefined}
        />
      </View>
    </View>
  );
}
