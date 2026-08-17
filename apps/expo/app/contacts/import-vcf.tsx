/**
 * VCF import — mirrors Swift VCFDocumentPicker.
 * Pick a .vcf file → parse → insert each contact.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { safeBack } from '@/navigation/safeBack';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { importFromVcf } from '@/contacts/importer';
import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { useTranslation } from '@/i18n';
import { pushToast } from '@/feedback/toast';

export default function ImportVcf() {
  const { t } = useTranslation();
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
      pushToast(t('contactVcf.importedToast', { count: inserted }), 'success');
    } catch (err) {
      pushToast(t('contactVcf.importFailed', { message: String((err as Error).message) }), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 pt-6">
        <ThemedButton variant="secondary" size="sm" label={t('contactVcf.back')} onPress={() => { safeBack(); }} />
      </View>
      <View className="px-4 py-4">
        <ThemedText variant="headlineLarge">{t('contactVcf.title')}</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          {t('contactVcf.subtitle')}
        </ThemedText>
      </View>

      <ThemedSurface variant="card" padded className="mx-4">
        <ThemedText variant="caption" tone="tertiary">{t('contactVcf.extractHeader')}</ThemedText>
        <ThemedText variant="bodySmall" className="mt-1">
          {t('contactVcf.extractFullName')}{'\n'}
          {t('contactVcf.extractEmailPhone')}{'\n'}
          {t('contactVcf.extractOrgTitle')}{'\n'}
          {t('contactVcf.extractPhoto')}
        </ThemedText>
      </ThemedSurface>

      {lastImport !== null ? (
        <ThemedSurface variant="card" padded className="mx-4 mt-3">
          <ThemedText variant="caption" tone="tertiary">{t('contactVcf.lastImportHeader')}</ThemedText>
          <ThemedText variant="bodyLarge" tabularNums>{t('contactVcf.lastImportCount', { count: lastImport })}</ThemedText>
        </ThemedSurface>
      ) : null}

      <View className="px-4 mt-6 mb-10">
        <ThemedButton
          label={busy ? t('contactVcf.importing') : t('contactVcf.pickFile')}
          fullWidth
          loading={busy}
          onPress={() => { void onPick(); }}
        />
      </View>
    </ScrollView>
  );
}
