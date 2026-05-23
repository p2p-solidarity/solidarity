/**
 * Vault list — mirrors Swift VaultListView. Shows encrypted file items
 * with size, type, and a single-tap detail route.
 */
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useVaultStore } from '@/vault/store';

const KIND_ICON: Readonly<Record<string, string>> = {
  file: '📄',
  json: '🧾',
  text: '📝',
  image: '🖼️',
  video: '🎞️',
  document: '📑',
};

function formatBytes(b: number): string {
  if (b < 1024) return `${String(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

export default function VaultHub() {
  const items = useVaultStore((s) => s.items);
  const hydrate = useVaultStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="flex-row items-center justify-between px-4 pt-6">
        <ThemedText variant="headlineLarge">Vault</ThemedText>
        <ThemedButton label="Add" size="sm" onPress={() => { router.push('/vault/new'); }} />
      </View>
      <ThemedText variant="bodySmall" tone="tertiary" className="mx-4 mt-1">
        End-to-end encrypted private storage.
      </ThemedText>

      {items.length === 0 ? (
        <ThemedSurface variant="outlined" padded className="mx-4 mt-6">
          <ThemedText variant="titleMedium">Empty vault</ThemedText>
          <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
            Files you add are encrypted at rest with your master key.
          </ThemedText>
        </ThemedSurface>
      ) : (
        items.map((it) => (
          <Pressable
            key={it.id}
            onPress={() => { router.push({ pathname: '/vault/[id]', params: { id: it.id } }); }}
            accessibilityRole="button"
            accessibilityLabel={`Open vault item ${it.name}`}
          >
            <ThemedSurface variant="card" padded className="mx-4 mt-2 flex-row">
              <ThemedText variant="headlineLarge" className="mr-3">
                {KIND_ICON[it.kind] ?? '📄'}
              </ThemedText>
              <View className="flex-1">
                <ThemedText variant="titleMedium" numberOfLines={1}>
                  {it.name}
                </ThemedText>
                <ThemedText variant="caption" tone="tertiary">
                  {formatBytes(it.size)} · updated {it.updatedAt.toLocaleDateString()}
                </ThemedText>
              </View>
            </ThemedSurface>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
