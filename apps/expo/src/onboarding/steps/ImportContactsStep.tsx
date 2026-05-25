/**
 * ImportContactsStep — 1:1 port of `importContactsStep` in Swift
 * OnboardingFlowView+Steps.swift.
 *
 * Body:
 *   "Bring your existing contacts into Solidarity.
 *    You can always import more later."
 *
 * Actions stack:
 *   - Imported badge: "Imported N contacts" with check-circle, terminalGreen
 *     accent, only visible after a successful import.
 *   - "Import from Phone" (primary) — opens OS contact picker.
 *   - "Import VCF File" (secondary) — opens document picker, parses .vcf.
 *
 * Footer: "Continue" if any imported, otherwise "Skip" (both inverted CTA).
 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { importFromDevicePicker, importFromVcf } from '@/contacts/importer';
import { pushToast } from '@/feedback/toast';
import { OnboardingScaffold } from './OnboardingScaffold';

export interface ImportContactsStepProps {
  readonly importedCount: number | null;
  readonly onBack: () => void;
  readonly onAdvance: () => void;
  readonly onImported: (count: number) => void;
}

export function ImportContactsStep({
  importedCount,
  onBack,
  onAdvance,
  onImported,
}: ImportContactsStepProps) {
  const [isWorking, setIsWorking] = useState(false);

  const handleVcfImport = async () => {
    setIsWorking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/vcard', 'text/x-vcard', 'application/x-vcard', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const text = await FileSystem.readAsStringAsync(asset.uri);
      const count = await importFromVcf(text);
      onImported(count);
      pushToast(`Imported ${String(count)} contacts`, 'success');
    } catch (err) {
      pushToast(`Import failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const handlePhoneImport = async () => {
    setIsWorking(true);
    try {
      const { granted, cancelled, count } = await importFromDevicePicker();
      if (!granted) {
        pushToast('Contacts access denied. Enable in Settings.', 'error');
        return;
      }
      if (cancelled) return;
      const total = (importedCount ?? 0) + count;
      onImported(total);
      pushToast(
        count === 1 ? 'Imported 1 contact' : `Imported ${String(count)} contacts`,
        'success'
      );
    } catch (err) {
      pushToast(`Import failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <OnboardingScaffold
      onBack={onBack}
      title="Import Contacts"
      subtitle={'Bring your existing contacts into Solidarity.\nYou can always import more later.'}
      footer={
        <ThemedButton
          label={importedCount !== null ? 'Continue' : 'Skip'}
          variant="inverted"
          fullWidth
          onPress={onAdvance}
        />
      }
    >
      <View style={{ flex: 1 }} />

      <View style={{ gap: 16 }}>
        {importedCount !== null ? <ImportedBadge count={importedCount} /> : null}

        {isWorking ? (
          <View style={{ alignItems: 'center', paddingVertical: 8 }}>
            <ActivityIndicator color={Colors.terminalGreen} />
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            <ThemedButton
              label="Import from Phone"
              fullWidth
              leadingIcon={<SfIcon name="person.crop.circle.badge.plus" size={17} color={Colors.invertedButtonText} />}
              onPress={() => { void handlePhoneImport(); }}
            />
            <ThemedButton
              label="Import VCF File"
              variant="secondary"
              fullWidth
              leadingIcon={<SfIcon name="doc.badge.plus" size={17} color={Colors.accentRose} />}
              onPress={() => { void handleVcfImport(); }}
            />
          </View>
        )}
      </View>

      <View style={{ flex: 1 }} />
    </OnboardingScaffold>
  );
}

function ImportedBadge({ count }: { count: number }): ReactNode {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: `${Colors.terminalGreen}4D`,
        backgroundColor: `${Colors.terminalGreen}14`,
      }}
    >
      <SfIcon name="checkmark.circle.fill" size={18} color={Colors.terminalGreen} />
      <ThemedText
        variant="bodyMedium"
        style={{ color: Colors.terminalGreen, fontFamily: 'Menlo', fontWeight: '600' }}
      >
        {`Imported ${String(count)} contacts`}
      </ThemedText>
    </View>
  );
}
