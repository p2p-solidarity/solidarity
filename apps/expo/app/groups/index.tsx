/**
 * Groups list — mirrors Swift GroupManagementView.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, View } from 'react-native';

import { useGroupStore } from '@/groups/store';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';

export default function GroupsHub() {
  const hydrate = useGroupStore((s) => s.hydrate);
  const groups = useGroupStore((s) => Array.from(s.groups.values()));

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="flex-row items-center justify-between px-4 pt-6">
        <ThemedText variant="headlineLarge">Groups</ThemedText>
        <ThemedButton label="New" size="sm" onPress={() => router.push('/groups/new')} />
      </View>

      {groups.length === 0 ? (
        <ThemedSurface variant="outlined" padded className="mx-4 mt-6">
          <ThemedText variant="titleMedium">No groups yet</ThemedText>
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
            Create one to issue group-bound credentials.
          </ThemedText>
        </ThemedSurface>
      ) : (
        groups.map((g) => (
          <ThemedSurface
            key={g.id}
            variant="card"
            padded
            className="mx-4 mt-2"
          >
            <ThemedText variant="titleMedium">{g.name}</ThemedText>
            <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
              {String(g.memberCount)} members · {g.isPrivate ? 'Private' : 'Public'}
            </ThemedText>
            <View className="mt-3">
              <ThemedButton
                variant="secondary"
                size="sm"
                label="Manage"
                onPress={() => router.push({ pathname: '/groups/[id]', params: { id: g.id } })}
              />
            </View>
          </ThemedSurface>
        ))
      )}
    </ScrollView>
  );
}
