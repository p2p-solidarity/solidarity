/**
 * VCF import — mirrors Swift VCFDocumentPicker.
 * Pick a .vcf file → parse → insert each contact.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { importFromVcf } from '@/contacts/importer';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';

export default function ImportVcf() {
  const [busy, setBusy] = useState(false);
  const [lastImport, setLastImport] = useState<number | null>(null);

  const onPick = async () => {
    setBusy(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/vcard', 'text/x-vcard', 'text/directory', 'public.vcard'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      if (!asset) return;
      const text = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const inserted = await importFromVcf(text);
      setLastImport(inserted);
      pushToast(`Imported ${String(inserted)} contacts`, 'success');
    } catch (err) {
      pushToast(`Import failed: ${String((err as Error).message)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6">
        <ThemedButton variant="secondary" size="sm" label="‹ Back" onPress={() => { router.back(); }} />
      </View>
      <View className="px-4 py-4">
        <ThemedText variant="headlineLarge">Import VCF</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          vCard 3.0 / 4.0 files from Contacts, Outlook, or any address book.
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">WHAT WE EXTRACT</ThemedText>
        <ThemedText variant="bodySmall" className="mt-1">
          • Full name (FN), given + family (N){'\n'}
          • Email + phone (first of each){'\n'}
          • Organization + title{'\n'}
          • Photo (if present)
        </ThemedText>
      </ThemedSurface>

      {lastImport !== null ? (
        <ThemedSurface variant="card" padded className="mx-4 mt-3">
          <ThemedText variant="caption" tone="tertiary">LAST IMPORT</ThemedText>
          <ThemedText variant="bodyLarge">{String(lastImport)} contacts</ThemedText>
        </ThemedSurface>
      ) : null}

      <View className="px-4 mt-6 mb-10">
        <ThemedButton
          label={busy ? 'Importing…' : 'Pick .vcf file'}
          fullWidth
          loading={busy}
          onPress={() => { void onPick(); }}
        />
      </View>
    </ScrollView>
  );
}
