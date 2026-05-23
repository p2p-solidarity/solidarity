/**
 * Passport flow entry — kicks off MRZ scan → NFC read → ZK proof → VC issuance.
 * Mirrors Swift PassportOnboardingFlowView.
 *
 * Real native deps (vision-camera frame processor for MRZ, nitro-nfc-passport
 * for chip read, nitro-passport-zk for proof) plug in via the `runPassportPipeline`
 * deps argument. Until they're built, this screen renders a stub flow that
 * dispatches mock step events so the UX wiring is testable.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { runPassportPipeline, type PassportStep } from '@/passport/pipeline';

export default function PassportEntry() {
  const [steps, setSteps] = useState<readonly PassportStep[]>([]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setSteps([]);
    try {
      await runPassportPipeline(
        { documentNumber: 'X1234567', dateOfBirth: '900101', dateOfExpiry: '300101' },
        {
          readChip: async () =>
            ({
              mrz: {
                nationality: 'TWN',
                documentNumber: 'X1234567',
                name: 'ADA LOVELACE',
                dateOfBirth: '900101',
                dateOfExpiry: '300101',
                gender: 'F',
              },
              dataGroups: {},
              passiveAuthValid: true,
            }) as const,
          generateProof: async () => new ArrayBuffer(32),
          issueVc: async () => 'demo.vc.jwt',
        },
        (s) => { setSteps((cur) => [...cur, s]); }
      );
      pushToast('Passport credential issued', 'success');
      router.back();
    } catch (err) {
      pushToast(`Failed: ${String((err as Error).message)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView className="flex-1 bg-pageBg">
      <View className="px-4 py-6">
        <ThemedText variant="headlineLarge">Passport</ThemedText>
        <ThemedText variant="bodySmall" tone="tertiary" className="mt-1">
          Scan MRZ → read NFC chip → generate ZK proof → issue VC. Stub flow
          until the nfc-passport + passport-zk Nitro modules are built.
        </ThemedText>
      </View>

      <View className="px-4">
        <ThemedButton
          label={busy ? 'Working…' : 'Start mock flow'}
          fullWidth
          loading={busy}
          onPress={() => void start()}
        />
      </View>

      <View className="px-4 py-6">
        {steps.map((s, i) => (
          <ThemedSurface key={String(i)} variant="card" padded className="mb-2">
            <ThemedText variant="caption" tone="tertiary">STEP {String(i + 1)}</ThemedText>
            <ThemedText variant="bodyLarge">{s.type}</ThemedText>
          </ThemedSurface>
        ))}
      </View>
    </ScrollView>
  );
}
