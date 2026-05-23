/**
 * Vault upload — pick a file → AES-GCM encrypt → write to documentDir →
 * insert metadata into the zustand vault store. Mirrors Swift
 * SovereignVaultService.importFile.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { writeVaultBlob } from '@/vault/storage';
import { useVaultStore, type VaultItemKind } from '@/vault/store';

function inferKind(mimeType: string | undefined, name: string): VaultItemKind {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType === 'application/json' || name.endsWith('.json')) return 'json';
  if (mimeType === 'text/plain' || name.endsWith('.txt')) return 'text';
  if (mimeType?.includes('pdf') || name.endsWith('.pdf')) return 'document';
  return 'file';
}

export default function VaultNew() {
  const upsert = useVaultStore((s) => s.upsert);
  const [busy, setBusy] = useState(false);

  const onPick = async () => {
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset) return;

      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const id = crypto.randomUUID();
      const written = await writeVaultBlob(id, base64);
      const now = new Date();
      await upsert({
        id,
        name: asset.name ?? 'file',
        kind: inferKind(asset.mimeType, asset.name ?? ''),
        mimeType: asset.mimeType,
        size: written.size,
        checksumSha256: written.checksumSha256,
        encryptedPath: written.encryptedPath,
        createdAt: now,
        updatedAt: now,
        tags: [],
      });
      pushToast(`Encrypted ${asset.name ?? 'file'} (${String(written.size)} B)`, 'success');
      router.back();
    } catch (err) {
      pushToast(`Upload failed: ${String((err as Error).message)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Add to vault</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Files are sealed with your master key (AES-256-GCM) before they touch disk.
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">PRIVACY</ThemedText>
        <ThemedText variant="bodySmall" className="mt-1">
          • Stored in your app's private documentDir{'\n'}
          • Plain bytes never persist after the picker copy step{'\n'}
          • Decryption requires the device's Keychain-backed master key
        </ThemedText>
      </ThemedSurface>

      <View className="px-4 mt-6">
        <ThemedButton
          label={busy ? 'Encrypting…' : 'Pick file'}
          fullWidth
          loading={busy}
          onPress={() => void onPick()}
        />
        <View className="mt-2">
          <ThemedButton
            variant="secondary"
            label="Cancel"
            fullWidth
            onPress={() => router.back()}
          />
        </View>
      </View>
    </ScrollView>
  );
}
