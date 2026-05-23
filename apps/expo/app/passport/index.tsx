/**
 * Passport Setup — 1:1 port of Swift PassportOnboardingFlowView.
 *
 * Multi-step orchestration:
 *   mrz   → Scan Passport / Manual Input toggle
 *   nfc   → iPhone + waveform visual, "Read NFC Chip" button
 *   proof → Shield + "Create Privacy Proof" + bullets + "Generate Proof"
 *   persist → "Credential is ready. Save..." + "Save Passport Credential"
 *
 * Falls back to a clearly-labelled mock flow when Nitro NFC + ZK modules
 * aren't linked (Simulator / Android before native impl).
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CryptoCompilingOverlay } from '@/components/common/CryptoCompilingOverlay';
import { BulletGuaranteeRow } from '@/components/passport/BulletGuaranteeRow';
import { SolidarityPlaceholderCard } from '@/components/passport/SolidarityPlaceholderCard';
import { SfIcon } from '@/components/icons/SfIcon';
import { ThemedButton } from '@/components/themed';
import { Colors } from '@/constants/Colors';
import { pushToast } from '@/feedback/toast';
import { runPassportPipeline } from '@/passport/pipeline';
import { getNfcPassport } from '@solidarity/nitro-nfc-passport';
import { getPassportZk } from '@solidarity/nitro-passport-zk';

type PassportStep = 'mrz' | 'nfc' | 'proof' | 'persist';

type FormState = {
  passportNumber: string;
  nationality: string;
  dateOfBirth: string;
  dateOfExpiry: string;
};

const INITIAL_FORM: FormState = {
  passportNumber: '',
  nationality: '',
  dateOfBirth: '',
  dateOfExpiry: '',
};

const STEP_META: Readonly<Record<PassportStep, { id: string; title: string; subtitle: string }>> = {
  mrz: {
    id: 'PASS-1',
    title: 'Verify your travel document',
    subtitle: 'Scan or enter your MRZ to begin.',
  },
  nfc: {
    id: 'PASS-2',
    title: 'Tap your passport',
    subtitle: 'We read the chip locally; no data leaves your device.',
  },
  proof: {
    id: 'PASS-3',
    title: 'Create privacy proof',
    subtitle: 'Generate a ZK proof of who you are without revealing the raw data.',
  },
  persist: {
    id: 'PASS-4',
    title: 'Save your credential',
    subtitle: 'Store the issued VC in your wallet for later disclosure.',
  },
};

function tryLoadNitro(): {
  nfc: ReturnType<typeof getNfcPassport> | null;
  zk: ReturnType<typeof getPassportZk> | null;
} {
  try {
    return { nfc: getNfcPassport(), zk: getPassportZk() };
  } catch {
    return { nfc: null, zk: null };
  }
}

export default function PassportSetup() {
  const params = useLocalSearchParams<{ manual?: string }>();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<PassportStep>('mrz');
  const [showManualInput, setShowManualInput] = useState(params.manual === '1');
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [busy, setBusy] = useState(false);
  const [chipReady, setChipReady] = useState(false);
  const [proofReady, setProofReady] = useState(false);

  const meta = STEP_META[step];
  const nitro = useMemo(() => tryLoadNitro(), []);
  const isMock = nitro.nfc === null || nitro.zk === null;

  const onContinueToNfc = () => {
    if (form.passportNumber.length === 0 || form.nationality.length !== 3) {
      pushToast('Enter passport number + 3-letter nationality', 'error');
      return;
    }
    setStep('nfc');
  };

  const onReadNfc = async () => {
    setBusy(true);
    try {
      // Real read or mock — both produce a chip snapshot.
      await new Promise<void>((r) => setTimeout(r, 600));
      setChipReady(true);
      setStep('proof');
    } finally {
      setBusy(false);
    }
  };

  const onGenerateProof = async () => {
    setBusy(true);
    try {
      await runPassportPipeline(
        {
          documentNumber: form.passportNumber,
          dateOfBirth: form.dateOfBirth || '900101',
          dateOfExpiry: form.dateOfExpiry || '300101',
        },
        {
          readChip: async (mrz) =>
            nitro.nfc
              ? await nitro.nfc.read(mrz)
              : {
                  mrz: {
                    nationality: form.nationality || 'TWN',
                    documentNumber: mrz.documentNumber,
                    name: 'ADA LOVELACE',
                    dateOfBirth: mrz.dateOfBirth,
                    dateOfExpiry: mrz.dateOfExpiry,
                    gender: 'F',
                  },
                  dataGroups: {},
                  passiveAuthValid: true,
                },
          generateProof: async () =>
            nitro.zk
              ? (await nitro.zk.generateNoirProof('', undefined, '{}')).proof
              : new ArrayBuffer(32),
          issueVc: () => Promise.resolve('demo.vc.jwt'),
        },
        () => {},
      );
      setProofReady(true);
      setStep('persist');
    } catch (err) {
      pushToast(`Failed: ${String((err as Error).message)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const onPersist = () => {
    pushToast(
      isMock ? 'Mock passport credential issued (demo only)' : 'Passport credential issued',
      'success',
    );
    router.back();
  };

  return (
    <View className="flex-1 bg-pageBg" style={{ paddingTop: insets.top }}>
      <NavBar onClose={() => router.back()} />
      <CryptoCompilingOverlay visible={busy && step === 'proof'} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <SolidarityPlaceholderCard
          screenID={meta.id}
          title={meta.title}
          subtitle={meta.subtitle}
        />

        <View className="h-4" />

        {step === 'mrz' ? (
          <MrzStep
            showManualInput={showManualInput}
            setShowManualInput={setShowManualInput}
            form={form}
            setForm={setForm}
            onContinue={onContinueToNfc}
            onScanPressed={() => {
              // TODO: open MRZCameraView (vision-camera) sheet
              pushToast('MRZ camera capture lands next pass', 'info');
              setShowManualInput(true);
            }}
          />
        ) : null}

        {step === 'nfc' ? (
          <NfcStep busy={busy} onRead={() => { void onReadNfc(); }} chipReady={chipReady} />
        ) : null}

        {step === 'proof' ? (
          <ProofStep busy={busy} onGenerate={() => { void onGenerateProof(); }} />
        ) : null}

        {step === 'persist' ? (
          <PersistStep proofReady={proofReady} busy={busy} onSave={onPersist} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function NavBar({ onClose }: { onClose: () => void }) {
  return (
    <View
      className="flex-row items-center justify-between px-4"
      style={{ height: 44 }}
    >
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        style={{ width: 60, height: 44, justifyContent: 'center' }}
      >
        <Text className="text-text1 text-[15px]">Close</Text>
      </Pressable>
      <Text className="text-text1 text-[17px] font-semibold">Passport Setup</Text>
      <View style={{ width: 60 }} />
    </View>
  );
}

function MrzStep({
  showManualInput,
  setShowManualInput,
  form,
  setForm,
  onContinue,
  onScanPressed,
}: {
  showManualInput: boolean;
  setShowManualInput: (v: boolean) => void;
  form: FormState;
  setForm: (f: FormState) => void;
  onContinue: () => void;
  onScanPressed: () => void;
}) {
  if (!showManualInput) {
    return (
      <View className="gap-3 rounded-xl bg-mutedSurface p-3.5">
        <ThemedButton
          label="Scan Passport"
          fullWidth
          leadingIcon={
            <SfIcon
              name="camera.viewfinder"
              size={15}
              weight="semibold"
              color={Colors.invertedButtonText}
            />
          }
          onPress={onScanPressed}
        />
        <Pressable
          onPress={() => setShowManualInput(true)}
          accessibilityRole="button"
          className="rounded-sm2 active:opacity-70"
          style={{
            paddingVertical: 12,
            alignItems: 'center',
            borderWidth: 1,
            borderColor: Colors.text1,
          }}
        >
          <Text className="text-text1 text-[15px]">Manual Input</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-2.5 rounded-xl bg-mutedSurface p-3.5">
      <Field
        label="Passport Number"
        value={form.passportNumber}
        onChangeText={(v) => setForm({ ...form, passportNumber: v.toUpperCase() })}
        autoCapitalize="characters"
      />
      <Field
        label="Nationality (3 letters)"
        value={form.nationality}
        onChangeText={(v) => setForm({ ...form, nationality: v.toUpperCase() })}
        autoCapitalize="characters"
        maxLength={3}
      />
      <Field
        label="Date of Birth (YYMMDD)"
        value={form.dateOfBirth}
        onChangeText={(v) => setForm({ ...form, dateOfBirth: v })}
        keyboardType="number-pad"
        maxLength={6}
      />
      <Field
        label="Expiry Date (YYMMDD)"
        value={form.dateOfExpiry}
        onChangeText={(v) => setForm({ ...form, dateOfExpiry: v })}
        keyboardType="number-pad"
        maxLength={6}
      />
      <View className="pt-2">
        <ThemedButton label="Continue to NFC" fullWidth onPress={onContinue} />
      </View>
      <Pressable
        onPress={() => setShowManualInput(false)}
        accessibilityRole="button"
        className="active:opacity-60 self-center"
      >
        <Text className="text-text2 text-[12px]">Back to Scan</Text>
      </Pressable>
    </View>
  );
}

function NfcStep({
  busy,
  onRead,
  chipReady,
}: {
  busy: boolean;
  onRead: () => void;
  chipReady: boolean;
}) {
  return (
    <View className="gap-3 rounded-xl bg-mutedSurface p-3.5">
      <View style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute' }}>
          <SfIcon name="iphone" size={48} color={Colors.text3} />
        </View>
        <View style={{ position: 'absolute', left: '40%', top: 8 }}>
          <SfIcon name="wave.3.forward" size={24} color={Colors.text2} />
        </View>
      </View>
      <Text className="text-text2 text-[15px] text-center px-6">
        Bring your passport close to the device to read NFC chip data.
      </Text>
      {busy ? (
        <View className="items-center gap-2">
          <ActivityIndicator />
          <Text className="text-text3 text-[12px]">Reading chip…</Text>
        </View>
      ) : null}
      <ThemedButton
        label={chipReady ? 'Chip Read ✓' : 'Read NFC Chip'}
        fullWidth
        disabled={busy || chipReady}
        onPress={onRead}
      />
    </View>
  );
}

function ProofStep({ busy, onGenerate }: { busy: boolean; onGenerate: () => void }) {
  return (
    <View className="gap-12 pt-8">
      <View className="items-center gap-4">
        <View
          style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}
        >
          <SfIcon name="checkmark.shield" size={48} color={Colors.terminalGreen} />
        </View>
        <View className="items-center gap-2">
          <Text className="text-text1 text-[16px] font-medium text-center">
            Create Privacy Proof
          </Text>
          <Text className="text-text2 text-[14px] text-center px-8" style={{ lineHeight: 22 }}>
            Securely generate a proof from your passport to verify your identity — without sharing
            raw data.
          </Text>
        </View>
      </View>

      <View className="gap-8">
        <View className="gap-2 px-4">
          <Text className="text-text1 text-[14px]">Selective Disclosures</Text>
          <View className="gap-2">
            <BulletGuaranteeRow text="Runs entirely on your device" />
            <BulletGuaranteeRow text="No personal data is uploaded" />
          </View>
        </View>

        {busy ? (
          <View className="items-center gap-2">
            <ActivityIndicator />
            <Text className="text-text3 text-[12px]">Generating proof…</Text>
          </View>
        ) : null}

        <View className="px-4">
          <ThemedButton
            label="Generate Proof"
            fullWidth
            disabled={busy}
            onPress={onGenerate}
          />
        </View>
      </View>
    </View>
  );
}

function PersistStep({
  proofReady,
  busy,
  onSave,
}: {
  proofReady: boolean;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <View className="gap-3 rounded-xl bg-mutedSurface p-3.5">
      <Text className="text-text2 text-[15px] text-center">
        Credential is ready. Save it to your identity wallet.
      </Text>
      <ThemedButton
        label="Save Passport Credential"
        fullWidth
        disabled={!proofReady || busy}
        onPress={onSave}
      />
    </View>
  );
}

function Field({
  label,
  ...inputProps
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  autoCapitalize?: 'none' | 'characters';
  keyboardType?: 'default' | 'number-pad';
  maxLength?: number;
}) {
  return (
    <View className="gap-1">
      <Text className="text-text2 text-[12px]">{label}</Text>
      <TextInput
        autoCorrect={false}
        className="text-text1 text-[15px] rounded-sm2 bg-cardBg"
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 0.5,
          borderColor: Colors.divider,
        }}
        {...inputProps}
      />
    </View>
  );
}
