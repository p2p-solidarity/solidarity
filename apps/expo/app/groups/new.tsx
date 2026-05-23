/**
 * Create group — mirrors Swift CreateGroupView. Persists a new GroupModel
 * to the zustand store; CloudKit/Drive sync happens out of band.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, TextInput, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useGroupStore } from '@/groups/store';
import { pushToast } from '@/feedback/toast';

export default function CreateGroup() {
  const upsertGroup = useGroupStore((s) => s.upsertGroup);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const onCreate = async () => {
    if (name.trim().length === 0) {
      pushToast('Name is required', 'warning');
      return;
    }
    const id = crypto.randomUUID();
    await upsertGroup({
      id,
      name: name.trim(),
      description: description.trim(),
      ownerRecordID: 'me',
      merkleRoot: undefined,
      merkleTreeDepth: 0,
      memberCount: 1,
      isPrivate,
      isSynced: false,
      credentialIssuers: [],
    });
    pushToast(`Created "${name}"`, 'success');
    router.replace({ pathname: '/groups/[id]', params: { id } });
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6">
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => { router.back(); }} />
      </View>
      <View className="px-4 py-4">
        <ThemedText variant="headlineLarge">New group</ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">NAME</ThemedText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Solidarity Founders"
          placeholderTextColor="#9C9C9C"
          autoCapitalize="words"
          className="text-text1 mt-1 py-1"
        />
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-3">
        <ThemedText variant="caption" tone="tertiary">DESCRIPTION (OPTIONAL)</ThemedText>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="What's this group for?"
          placeholderTextColor="#9C9C9C"
          multiline
          numberOfLines={4}
          className="text-text1 mt-1"
          style={{ minHeight: 80, textAlignVertical: 'top' }}
        />
      </ThemedSurface>

      <ThemedSurface variant="card" padded className="mx-4 mt-3 flex-row items-center justify-between">
        <View className="flex-1 mr-3">
          <ThemedText variant="bodyLarge">Private group</ThemedText>
          <ThemedText variant="caption" tone="tertiary" className="mt-0.5">
            Only invited members can see this group.
          </ThemedText>
        </View>
        <Switch value={isPrivate} onValueChange={setIsPrivate} />
      </ThemedSurface>

      <View className="px-4 mt-6 mb-10">
        <ThemedButton
          label="Create group"
          fullWidth
          disabled={name.trim().length === 0}
          onPress={() => { void onCreate(); }}
        />
      </View>
    </ScrollView>
  );
}
