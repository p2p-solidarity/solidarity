/**
 * Vault list — no Swift counterpart; aligns visual style with Me/Settings.
 *
 * Uses the SettingsBackToolbar + SettingsScreenTitle pattern so the page
 * shares typography and chrome with the rest of the app. Each vault item
 * renders as a mutedSurface row (SettingsBlockRow look), with an empty
 * state when there are no encrypted blobs.
 */
import { router } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { Colors } from '@/constants/Colors';
import { useVaultStore, type VaultItem } from '@/vault/store';

import type { SFSymbol } from 'expo-symbols';

const KIND_ICON: Readonly<Record<VaultItem['kind'], SFSymbol>> = {
  file: 'doc',
  json: 'curlybraces',
  text: 'doc.text',
  image: 'photo',
  video: 'film',
  document: 'doc.richtext',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function VaultRow({ item }: { readonly item: VaultItem }): ReactNode {
  return (
    <Pressable
      onPress={() => {
        // Vault detail screen is not yet implemented; tap is a no-op
        // and keeps the row visible with chevron parity. Wires when
        // /vault/[id] lands.
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}`}
      className="active:opacity-80"
    >
      <View
        className="bg-mutedSurface rounded-xl flex-row items-center"
        style={{ paddingHorizontal: 14, paddingVertical: 14 }}
      >
        <View
          style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <SfIcon name={KIND_ICON[item.kind]} size={14} color={Colors.text1} />
        </View>
        <View className="flex-1">
          <Text className="text-text1 text-[15px]" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="text-text3 text-[12px]" style={{ marginTop: 2 }}>
            {formatBytes(item.size)} · updated {item.updatedAt.toLocaleDateString()}
          </Text>
        </View>
        <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
      </View>
    </Pressable>
  );
}

export default function VaultHub() {
  const insets = useSafeAreaInsets();
  const items = useVaultStore((s) => s.items);
  const hydrate = useVaultStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title="Back" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Vault" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 + insets.bottom }}
      >
        <View className="gap-2">
          <SettingsBlockSectionHeader title="Encrypted files" />
          <Text className="px-4 text-text3 text-[12px]">
            End-to-end encrypted private storage.
          </Text>
        </View>

        <View className="h-4" />

        <View className="px-4">
          <Pressable
            onPress={() => { router.push('/vault/new'); }}
            accessibilityRole="button"
            accessibilityLabel="Add to vault"
            className="active:opacity-80"
          >
            <View
              className="bg-mutedSurface rounded-xl flex-row items-center"
              style={{ paddingHorizontal: 14, paddingVertical: 14 }}
            >
              <View
                style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
              >
                <SfIcon name="plus" size={14} color={Colors.text1} />
              </View>
              <Text className="text-text1 text-[15px] flex-1">Add to vault</Text>
              <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
            </View>
          </Pressable>
        </View>

        <View className="h-6" />

        <View className="gap-2">
          <SettingsBlockSectionHeader title={`Items (${String(items.length)})`} />
          {items.length === 0 ? (
            <Text className="px-4 text-text3 text-[12px]">
              No files yet. Files added here are sealed with your master key (AES-256-GCM) before they touch disk.
            </Text>
          ) : (
            <View className="px-4 gap-2">
              {items.map((it) => (
                <VaultRow key={it.id} item={it} />
              ))}
            </View>
          )}
        </View>

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
