/**
 * Vault upload — pick a file → AES-GCM encrypt → write to documentDir →
 * insert metadata into the zustand vault store. Mirrors Swift
 * SovereignVaultService.importFile.
 *
 * Styling aligns with the rest of the app (SettingsBackToolbar + screen
 * title + mutedSurface info block).
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SfIcon } from '@/components/icons/SfIcon';
import {
  SettingsBackToolbar,
  SettingsBlockSectionHeader,
  SettingsScreenTitle,
} from '@/components/settings/SettingsBlocks';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { writeVaultBlob } from '@/vault/storage';
import { useVaultStore, type VaultItemKind } from '@/vault/store';
import { uuid } from '@solidarity/shared';

function inferKind(mimeType: string | undefined, name: string): VaultItemKind {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType === 'application/json' || name.endsWith('.json')) return 'json';
  if (mimeType === 'text/plain' || name.endsWith('.txt')) return 'text';
  if (mimeType?.includes('pdf') || name.endsWith('.pdf')) return 'document';
  return 'file';
}

function InfoBullet({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <View className="flex-row" style={{ marginTop: 6 }}>
      <Text className="text-text2 text-[13px]" style={{ width: 16 }}>
        •
      </Text>
      <Text className="text-text2 text-[13px] flex-1">{children}</Text>
    </View>
  );
}

export default function VaultNew() {
  const insets = useSafeAreaInsets();
  const upsert = useVaultStore((s) => s.upsert);
  const [busy, setBusy] = useState(false);

  const onPick = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) {
        setBusy(false);
        return;
      }
      const asset = res.assets[0];
      if (!asset) {
        setBusy(false);
        return;
      }

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const id = uuid();
      const written = await writeVaultBlob(id, base64);
      const now = new Date();
      const name = asset.name || 'file';
      await upsert({
        id,
        name,
        kind: inferKind(asset.mimeType, name),
        mimeType: asset.mimeType,
        size: written.size,
        checksumSha256: written.checksumSha256,
        encryptedPath: written.encryptedPath,
        createdAt: now,
        updatedAt: now,
        tags: [],
      });
      pushToast(`Encrypted ${name} (${written.size.toFixed(0)} B)`, 'success');
      router.back();
    } catch (err) {
      pushToast(`Upload failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <SettingsBackToolbar title="Vault" onPress={() => { router.back(); }} />
      <SettingsScreenTitle title="Add to vault" />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: 60 + insets.bottom }}
      >
        <View className="gap-2">
          <SettingsBlockSectionHeader title="About" />
          <Text className="px-4 text-text3 text-[12px]">
            Files are sealed with your master key (AES-256-GCM) before they touch disk.
          </Text>
        </View>

        <View className="h-6" />

        <View className="gap-2">
          <SettingsBlockSectionHeader title="Privacy" />
          <View className="px-4">
            <View
              className="bg-mutedSurface rounded-xl"
              style={{ paddingHorizontal: 14, paddingVertical: 14 }}
            >
              <View className="flex-row items-center">
                <View
                  style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
                >
                  <SfIcon name="lock.shield" size={14} color={Colors.text1} />
                </View>
                <Text className="text-text1 text-[15px] flex-1">Local-first storage</Text>
              </View>
              <View style={{ marginTop: 6, paddingLeft: 32 }}>
                <InfoBullet>Stored in your app&apos;s private documentDir</InfoBullet>
                <InfoBullet>Plain bytes never persist after the picker copy step</InfoBullet>
                <InfoBullet>Decryption requires the device&apos;s Keychain-backed master key</InfoBullet>
              </View>
            </View>
          </View>
        </View>

        <View className="h-8" />

        <View className="px-4 gap-2">
          <ThemedButton
            label={busy ? 'Encrypting…' : 'Pick file'}
            fullWidth
            loading={busy}
            onPress={() => void onPick()}
          />
          <ThemedButton
            variant="secondary"
            label="Cancel"
            fullWidth
            onPress={() => { router.back(); }}
          />
        </View>
      </ScrollView>
    </View>
  );
}
