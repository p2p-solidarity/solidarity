/**
 * Vault list — no Swift counterpart; aligns visual style with Me/Settings.
 *
 * Uses the SettingsBackToolbar + SettingsScreenTitle pattern so the page
 * shares typography and chrome with the rest of the app. Each vault item
 * renders as a mutedSurface row (SettingsBlockRow look), with an empty
 * state when there are no encrypted blobs.
 */
import { router } from 'expo-router';
import { safeBack } from '@/navigation/safeBack';
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
import { useTranslation } from '@/i18n';
import {
  useVaultStore,
  type VaultItem,
  type VaultItemKind,
  type VaultManifestEntry,
} from '@/vault/store';

import type { SFSymbol } from 'expo-symbols';

const KIND_ICON: Readonly<Record<VaultItemKind, SFSymbol>> = {
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

interface VaultRowProps {
  readonly entry: VaultManifestEntry;
  readonly detail: VaultItem | undefined;
}

function VaultRow({ entry, detail }: VaultRowProps): ReactNode {
  const { t } = useTranslation();
  // Frame-1 paint uses the manifest entry (kind + size + updatedAt). The
  // filename is encrypted-only — see vaultManifest.ts privacy note — so
  // we show a neutral placeholder until `hydrate()` decrypts it.
  const displayName = detail?.name ?? t('vault.encryptedItem');
  const updatedDate = detail?.updatedAt ?? new Date(entry.updatedAt);
  return (
    <Pressable
      onPress={() => {
        // Vault detail screen is not yet implemented; tap is a no-op
        // and keeps the row visible with chevron parity. Wires when
        // /vault/[id] lands.
      }}
      accessibilityRole="button"
      accessibilityLabel={t('vault.openItem', { name: displayName })}
      className="active:opacity-80"
    >
      <View
        className="bg-mutedSurface rounded-xl flex-row items-center"
        style={{ paddingHorizontal: 14, paddingVertical: 14 }}
      >
        <View
          style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <SfIcon name={KIND_ICON[entry.kind]} size={14} color={Colors.text1} />
        </View>
        <View className="flex-1">
          <Text className="text-text1 text-[15px]" numberOfLines={1}>
            {displayName}
          </Text>
          <Text className="text-text3 text-[12px]" style={{ marginTop: 2 }}>
            {t('vault.rowMeta', {
              size: formatBytes(entry.size),
              date: updatedDate.toLocaleDateString(),
            })}
          </Text>
        </View>
        <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
      </View>
    </Pressable>
  );
}

export default function VaultHub() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const manifest = useVaultStore((s) => s.manifest);
  const details = useVaultStore((s) => s.details);
  const seedFromManifest = useVaultStore((s) => s.seedFromManifest);
  const hydrate = useVaultStore((s) => s.hydrate);

  // Frame 1: paint manifest from sync MMKV (no awaits). Then fire the
  // background bulk decrypt so names + the rest of `VaultItem` populate.
  useEffect(() => {
    seedFromManifest();
    void hydrate();
  }, [seedFromManifest, hydrate]);

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title={t('vault.back')} onPress={() => { safeBack(); }} />
      <SettingsScreenTitle title={t('vault.title')} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 + insets.bottom }}
      >
        <View className="gap-2">
          <SettingsBlockSectionHeader title={t('vault.encryptedFiles')} />
          <Text className="px-4 text-text3 text-[12px]">
            {t('vault.encryptedFilesSubtitle')}
          </Text>
        </View>

        <View className="h-4" />

        <View className="px-4">
          <Pressable
            onPress={() => { router.push('/vault/new'); }}
            accessibilityRole="button"
            accessibilityLabel={t('vault.addToVault')}
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
              <Text className="text-text1 text-[15px] flex-1">{t('vault.addToVault')}</Text>
              <SfIcon name="chevron.right" size={12} weight="semibold" color={Colors.text3} />
            </View>
          </Pressable>
        </View>

        <View className="h-6" />

        <View className="gap-2">
          <SettingsBlockSectionHeader title={t('vault.itemsCount', { count: manifest.length })} />
          {manifest.length === 0 ? (
            <Text className="px-4 text-text3 text-[12px]">
              {t('vault.emptyState')}
            </Text>
          ) : (
            <View className="px-4 gap-2">
              {manifest.map((entry) => (
                <VaultRow
                  key={entry.id}
                  entry={entry}
                  detail={details.get(entry.id)}
                />
              ))}
            </View>
          )}
        </View>

        <View className="h-8" />
      </ScrollView>
    </View>
  );
}
