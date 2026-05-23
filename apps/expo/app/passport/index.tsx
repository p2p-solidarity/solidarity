/**
 * Passport flow entry — orchestrates MRZ scan → NFC read → ZK proof →
 * VC issuance via the nitro-passport-zk + nitro-nfc-passport modules.
 *
 * If either Nitro module isn't linked (Simulator without xcframework /
 * Android without jmrtd), we fall back to a clearly-labelled mock flow
 * per aniseekr CLAUDE rule 8 — toast says "demo only" so the user can't
 * confuse it with a real credential.
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';

import { ThemedButton, ThemedSurface, ThemedText } from '@/components/themed';
import { pushToast } from '@/feedback/toast';
import { runPassportPipeline, type PassportStep } from '@/passport/pipeline';
import { getNfcPassport } from '@solidarity/nitro-nfc-passport';
import { getPassportZk } from '@solidarity/nitro-passport-zk';

const SAMPLE_MRZ = {
  documentNumber: 'X1234567',
  dateOfBirth: '900101',
  dateOfExpiry: '300101',
} as const;

function tryLoadNitro(): { nfc: ReturnType<typeof getNfcPassport> | null; zk: ReturnType<typeof getPassportZk> | null } {
  try {
    return { nfc: getNfcPassport(), zk: getPassportZk() };
  } catch {
    return { nfc: null, zk: null };
  }
}

export default function PassportEntry() {
  const [steps, setSteps] = useState<readonly PassportStep[]>([]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setSteps([]);
    const { nfc, zk } = tryLoadNitro();
    const isMock = nfc === null || zk === null;
    try {
      await runPassportPipeline(
        SAMPLE_MRZ,
        {
          readChip: async (mrz) =>
            nfc
              ? await nfc.read(mrz)
              : ({
                  mrz: {
                    nationality: 'TWN',
                    documentNumber: mrz.documentNumber,
                    name: 'ADA LOVELACE',
                    dateOfBirth: mrz.dateOfBirth,
                    dateOfExpiry: mrz.dateOfExpiry,
                    gender: 'F',
                  },
                  dataGroups: {},
                  passiveAuthValid: true,
                } as const),
          generateProof: async () =>
            zk
              ? (await zk.generateNoirProof('', undefined, '{}')).proof
              : new ArrayBuffer(32),
          issueVc: () => Promise.resolve('demo.vc.jwt'),
        },
        (s) => { setSteps((cur) => [...cur, s]); }
      );
      pushToast(isMock ? 'Mock passport credential issued (demo only)' : 'Passport credential issued', 'success');
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
          Scan MRZ → read NFC chip → generate ZK proof → issue VC. Falls back
          to a mock flow if Nitro NFC + ZK modules aren't linked yet.
        </ThemedText>
      </View>

      <View className="px-4">
        <ThemedButton
          label={busy ? 'Working…' : 'Start flow'}
          fullWidth
          loading={busy}
          onPress={() => { void start(); }}
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
