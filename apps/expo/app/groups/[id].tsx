/**
 * Group detail — mirrors Swift GroupDetailView. Lists members + shows the
 * Merkle root + admin actions.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';

import { useGroup, useGroupMembers } from '@/groups/store';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function GroupDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const group = useGroup(id);
  const members = useGroupMembers(id);

  if (!group) {
    return (
      <View className="flex-1 bg-pageBg items-center justify-center p-6">
        <ThemedText>Group not found.</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6 pb-2">
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => router.back()} />
      </View>
      <View className="px-4">
        <ThemedText variant="headlineLarge">{group.name}</ThemedText>
        {group.description ? (
          <ThemedText variant="bodyMedium" tone="secondary">
            {group.description}
          </ThemedText>
        ) : null}
      </View>

      <ThemedSurface variant="card" padded className="mx-4 mt-4">
        <ThemedText variant="caption" tone="tertiary">MERKLE ROOT</ThemedText>
        <ThemedText variant="bodySmall" selectable>
          {group.merkleRoot ?? 'not computed'}
        </ThemedText>
      </ThemedSurface>

      <View className="px-4 mt-6">
        <ThemedText variant="titleMedium">Members ({String(members.length)})</ThemedText>
      </View>
      {members.map((m) => (
        <ThemedSurface key={m.id} variant="card" padded className="mx-4 mt-2">
          <ThemedText variant="bodyLarge">{m.userRecordID}</ThemedText>
          <ThemedText variant="caption" tone="tertiary">
            {m.role} · {m.status} · joined {m.joinedAt.toLocaleDateString()}
          </ThemedText>
        </ThemedSurface>
      ))}
    </ScrollView>
  );
}
