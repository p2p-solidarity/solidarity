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
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';

import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton, ThemedText } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { importFromVcf } from '@/contacts/importer';
import { useContactStore } from '@/contacts/repository';
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
  // Watch the in-memory manifest so when the picker screen finishes upserting
  // and pops back here, we surface the new total + flip the "Continue" CTA.
  const manifestCount = useContactStore((s) => s.manifest.length);
  useEffect(() => {
    if (manifestCount > 0 && manifestCount !== importedCount) {
      onImported(manifestCount);
    }
  }, [manifestCount, importedCount, onImported]);

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
      // The manifest-watching effect below sets `importedCount` to the new
      // total — don't also report the delta here or the two race / double up.
      pushToast(`Imported ${String(count)} contacts`, 'success');
    } catch (err) {
      pushToast(`Import failed: ${(err as Error).message}`, 'error');
    } finally {
      setIsWorking(false);
    }
  };

  const handlePhoneImport = () => {
    // Multi-select picker — pushes a sheet that lets the user choose which
    // contacts to bring in. On dismiss we re-read the manifest count above
    // so the imported badge / CTA reflects the result.
    router.push('/contacts/import-phone');
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
              onPress={handlePhoneImport}
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
