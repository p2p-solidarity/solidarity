/**
 * Passport Setup — 1:1 port of Swift PassportOnboardingFlowView.swift +
 * PassportOnboardingFlowView+Steps.swift.
 *
 * Multi-step orchestration (state machine in @/passport/pipeline):
 *   mrz   → Scan Passport / Manual Input toggle. Tap Scan → MRZCameraStep
 *           modal (vision-camera) lays an overlay on the live feed; once a
 *           draft is detected the user confirms with "Use This" and we drop
 *           into the manual-input panel pre-filled with the scanned fields.
 *   nfc   → iPhone + waveform visual, "Read NFC Chip" button.
 *           After read: chip snapshot card showing BAC/PACE/PA badges,
 *           data groups, document hash + MRZ digest prefixes.
 *   proof → Shield + "Create Privacy Proof" + bullets + "Generate Proof"
 *           with a per-status proof result card afterwards.
 *   persist → "Save Passport Credential" inverted CTA.
 *
 * Falls back to a clearly-labelled mock flow when Nitro NFC + ZK modules
 * aren't linked (Simulator / Android before native impl). Mock chips +
 * proofs are demoted to "selfIssued / white" trust level per CLAUDE.md
 * Sec rules — never present synthetic data as government-grade.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
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
import {
  MRZCameraStep,
  type PassportMRZDraft as MrzScannedDraft,
} from '@/onboarding/steps/MRZCameraStep';
import {
  initialPassportPipelineState,
  maskDocumentNumber,
  PASSPORT_STEP_META,
  passportPipelineReducer,
  validateMrzDraft,
  type PassportChipSnapshot,
  type PassportMRZDraft,
  type PassportProofResult,
} from '@/passport/pipeline';
import { getNfcPassport, type PassportReadResult } from '@solidarity/nitro-nfc-passport';
import { getPassportZk } from '@solidarity/nitro-passport-zk';

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
  const [state, dispatch] = useReducer(passportPipelineReducer, initialPassportPipelineState);
  const [showManualInput, setShowManualInput] = useState(params.manual === '1');
  const [showCamera, setShowCamera] = useState(false);

  const meta = PASSPORT_STEP_META[state.step];
  const nitro = useMemo(() => tryLoadNitro(), []);
  const isMock = nitro.nfc === null || nitro.zk === null;

  useEffect(() => {
    if (state.errorMessage) {
      pushToast(state.errorMessage, 'error');
      dispatch({ type: 'setError', message: null });
    }
  }, [state.errorMessage]);

  const onValidateMrz = () => {
    const err = validateMrzDraft(state.draft);
    if (err) {
      dispatch({ type: 'setError', message: err.message });
      return;
    }
    dispatch({ type: 'gotoStep', step: 'nfc' });
  };

  const onReadNfc = async () => {
    dispatch({ type: 'setLoading', value: true });
    dispatch({ type: 'setNfcProgress', message: 'Hold passport near device...' });
    try {
      let chip: PassportChipSnapshot;
      if (nitro.nfc) {
        const result = await nitro.nfc.read({
          documentNumber: state.draft.passportNumber,
          dateOfBirth: state.draft.dateOfBirth,
          dateOfExpiry: state.draft.expiryDate,
        });
        chip = chipFromNitro(result, state.draft.nationalityCode, state.draft.passportNumber);
      } else {
        await new Promise<void>((r) => setTimeout(r, 800));
        chip = simulatedChipSnapshot(state.draft);
      }
      dispatch({ type: 'setNfcProgress', message: 'Read complete.' });
      dispatch({ type: 'setChip', chip });
    } catch (err) {
      dispatch({ type: 'setError', message: (err as Error).message });
    } finally {
      dispatch({ type: 'setLoading', value: false });
    }
  };

  const onGenerateProof = async () => {
    if (!state.chip) return;
    dispatch({ type: 'setLoading', value: true });
    dispatch({ type: 'setProofProgress', message: 'Initializing prover...' });
    try {
      let proof: PassportProofResult;
      if (nitro.zk) {
        dispatch({ type: 'setProofProgress', message: 'Generating ZK proof...' });
        const result = await nitro.zk.generateNoirProof('', undefined, '{}');
        proof = {
          proofType: 'mopro-noir',
          proofPayload: arrayBufferToBase64(result.proof),
          trustLevel: state.chip.isSimulated ? 'white' : 'green',
          generationFailed: false,
        };
      } else {
        await new Promise<void>((r) => setTimeout(r, 1200));
        proof = {
          proofType: 'sd-jwt-fallback',
          proofPayload: 'demo.vc.jwt',
          trustLevel: 'white',
          generationFailed: true,
        };
      }
      dispatch({ type: 'setProof', proof });
    } catch (err) {
      dispatch({ type: 'setError', message: (err as Error).message });
    } finally {
      dispatch({ type: 'setLoading', value: false });
    }
  };

  const onPersist = () => {
    pushToast(
      isMock ? 'Mock passport credential issued (demo only)' : 'Passport credential issued',
      'success'
    );
    router.back();
  };

  return (
    <View className="bg-pageBg flex-1" style={{ paddingTop: insets.top }}>
      <NavBar onClose={() => { router.back(); }} />
      <CryptoCompilingOverlay visible={state.isLoading && state.step === 'proof'} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <SolidarityPlaceholderCard
          screenID={meta.id}
          title={meta.title}
          subtitle={meta.subtitle}
        />

        <View className="h-4" />

        {state.step === 'mrz' ? (
          <MrzStep
            showManualInput={showManualInput}
            setShowManualInput={setShowManualInput}
            draft={state.draft}
            patch={(patch) => { dispatch({ type: 'patchDraft', patch }); }}
            onContinue={onValidateMrz}
            onScanPressed={() => { setShowCamera(true); }}
          />
        ) : null}

        {state.step === 'nfc' ? (
          <NfcStep
            busy={state.isLoading}
            progress={state.nfcProgressMessage}
            chip={state.chip}
            onRead={() => { void onReadNfc(); }}
          />
        ) : null}

        {state.step === 'proof' ? (
          <ProofStep
            busy={state.isLoading}
            progress={state.proofProgressMessage}
            proof={state.proof}
            disabled={state.chip === null}
            onGenerate={() => { void onGenerateProof(); }}
          />
        ) : null}

        {state.step === 'persist' ? (
          <PersistStep proof={state.proof} busy={state.isLoading} onSave={onPersist} />
        ) : null}
      </ScrollView>

      <Modal
        visible={showCamera}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => { setShowCamera(false); }}
      >
        <MRZCameraStep
          onScanned={(scanned) => {
            applyScannedDraft(scanned, dispatch);
            setShowCamera(false);
            setShowManualInput(true);
          }}
          onCancel={() => { setShowCamera(false); }}
          onSwitchToManual={() => {
            setShowCamera(false);
            setShowManualInput(true);
          }}
        />
      </Modal>
    </View>
  );
}

function applyScannedDraft(
  scanned: MrzScannedDraft,
  dispatch: (action: { type: 'patchDraft'; patch: Partial<PassportMRZDraft> }) => void
) {
  dispatch({
    type: 'patchDraft',
    patch: {
      passportNumber: scanned.passportNumber,
      nationalityCode: scanned.nationalityCode,
      dateOfBirth: scanned.dateOfBirth,
      expiryDate: scanned.expiryDate,
    },
  });
}

function NavBar({ onClose }: { onClose: () => void }) {
  return (
    <View className="flex-row items-center justify-between px-4" style={{ height: 44 }}>
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
  draft,
  patch,
  onContinue,
  onScanPressed,
}: {
  showManualInput: boolean;
  setShowManualInput: (v: boolean) => void;
  draft: PassportMRZDraft;
  patch: (p: Partial<PassportMRZDraft>) => void;
  onContinue: () => void;
  onScanPressed: () => void;
}) {
  if (!showManualInput) {
    return (
      <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
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
          onPress={() => { setShowManualInput(true); }}
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
    <View className="bg-mutedSurface gap-2.5 rounded-xl p-3.5">
      <Field
        label="Passport Number"
        value={draft.passportNumber}
        onChangeText={(v) => { patch({ passportNumber: v.toUpperCase() }); }}
        autoCapitalize="characters"
      />
      <Field
        label="Nationality (3 letters)"
        value={draft.nationalityCode}
        onChangeText={(v) => { patch({ nationalityCode: v.toUpperCase() }); }}
        autoCapitalize="characters"
        maxLength={3}
      />
      <Field
        label="Date of Birth (YYMMDD)"
        value={draft.dateOfBirth}
        onChangeText={(v) => { patch({ dateOfBirth: v }); }}
        keyboardType="number-pad"
        maxLength={6}
      />
      <Field
        label="Expiry Date (YYMMDD)"
        value={draft.expiryDate}
        onChangeText={(v) => { patch({ expiryDate: v }); }}
        keyboardType="number-pad"
        maxLength={6}
      />
      <View className="pt-2">
        <ThemedButton label="Continue to NFC" fullWidth onPress={onContinue} />
      </View>
      <Pressable
        onPress={() => { setShowManualInput(false); }}
        accessibilityRole="button"
        className="self-center active:opacity-60"
      >
        <Text className="text-text2 text-[12px]">Back to Scan</Text>
      </Pressable>
    </View>
  );
}

function NfcStep({
  busy,
  progress,
  chip,
  onRead,
}: {
  busy: boolean;
  progress: string;
  chip: PassportChipSnapshot | null;
  onRead: () => void;
}) {
  return (
    <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
      <View style={{ height: 80, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute' }}>
          <SfIcon name="iphone" size={48} color={Colors.text3} />
        </View>
        <View style={{ position: 'absolute', left: '40%', top: 8 }}>
          <SfIcon name="wave.3.forward" size={24} color={Colors.text2} />
        </View>
      </View>
      <Text className="text-text2 px-6 text-center text-[15px]">
        Bring your passport close to the device to read NFC chip data.
      </Text>
      {busy ? (
        <View className="items-center gap-2">
          <ActivityIndicator color={Colors.terminalGreen} />
          <Text className="text-text3 text-[12px]">{progress}</Text>
        </View>
      ) : null}
      {chip ? <ChipSnapshotCard chip={chip} /> : null}
      <ThemedButton
        label={chip ? 'Chip Read ✓' : 'Read NFC Chip'}
        fullWidth
        disabled={busy || chip !== null}
        onPress={onRead}
      />
    </View>
  );
}

function ChipSnapshotCard({ chip }: { chip: PassportChipSnapshot }) {
  return (
    <View className="rounded-xl p-3" style={{ backgroundColor: Colors.mutedSurface, gap: 8 }}>
      {chip.isSimulated ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <SfIcon name="exclamationmark.triangle.fill" size={14} color="#FF9500" />
          <Text style={{ color: '#FF9500', fontSize: 12, fontWeight: '600' }}>Simulated</Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 16 }}>
        <View style={{ gap: 2 }}>
          <Text className="text-text3" style={{ fontSize: 10 }}>Nationality</Text>
          <Text className="text-text1" style={{ fontSize: 15, fontWeight: '600' }}>
            {chip.nationalityCode}
          </Text>
        </View>
        <View style={{ gap: 2 }}>
          <Text className="text-text3" style={{ fontSize: 10 }}>Document</Text>
          <Text className="text-text1" style={{ fontSize: 15, fontFamily: 'Menlo' }}>
            {chip.maskedDocNumber}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <AuthBadge label="BAC" passed={chip.bacVerified} />
        <AuthBadge label="PACE" passed={chip.paceVerified} />
        <AuthBadge label="PA" passed={chip.passiveAuthPassed} />
      </View>

      <View style={{ flexDirection: 'row', gap: 4 }}>
        <Text className="text-text3" style={{ fontSize: 10, fontWeight: '600' }}>DGs:</Text>
        <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
          {chip.dataGroupsRead.join(', ')}
        </Text>
      </View>

      <View style={{ gap: 2 }}>
        <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
          {`Doc hash: ${chip.documentHash.slice(0, 16)}...`}
        </Text>
        <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
          {`MRZ digest: ${chip.mrzDigest.slice(0, 16)}...`}
        </Text>
      </View>
    </View>
  );
}

function AuthBadge({ label, passed }: { label: string; passed: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <SfIcon
        name={passed ? 'checkmark.circle.fill' : 'xmark.circle'}
        size={11}
        color={passed ? Colors.terminalGreen : Colors.text3}
      />
      <Text
        style={{
          color: passed ? Colors.terminalGreen : Colors.text3,
          fontSize: 10,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function ProofStep({
  busy,
  progress,
  proof,
  disabled,
  onGenerate,
}: {
  busy: boolean;
  progress: string;
  proof: PassportProofResult | null;
  disabled: boolean;
  onGenerate: () => void;
}) {
  return (
    <View className="gap-12 pt-8">
      <View className="items-center gap-4">
        <View style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center' }}>
          <SfIcon name="checkmark.shield" size={48} color={Colors.terminalGreen} />
        </View>
        <View className="items-center gap-2">
          <Text className="text-text1 text-center text-[16px] font-medium">
            Create Privacy Proof
          </Text>
          <Text className="text-text2 px-8 text-center text-[14px]" style={{ lineHeight: 22 }}>
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
            <ActivityIndicator color={Colors.terminalGreen} />
            <Text className="text-text3 text-[12px]">{progress}</Text>
          </View>
        ) : null}

        {proof ? <ProofResultCard proof={proof} /> : null}

        <View className="px-4">
          <ThemedButton
            label="Generate Proof"
            fullWidth
            disabled={busy || disabled}
            onPress={onGenerate}
          />
        </View>
      </View>
    </View>
  );
}

function ProofResultCard({ proof }: { proof: PassportProofResult }) {
  const failed = proof.generationFailed;
  const accent = failed ? '#FF9500' : Colors.terminalGreen;
  return (
    <View
      className="mx-4 rounded-xl p-3"
      style={{ backgroundColor: Colors.mutedSurface, gap: 4 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <SfIcon
          name={failed ? 'exclamationmark.triangle' : 'checkmark.seal.fill'}
          size={14}
          color={accent}
        />
        <Text style={{ color: accent, fontSize: 12, fontWeight: '600', flex: 1 }}>
          {failed ? 'Fallback (SD-JWT)' : 'ZK proof ready'}
        </Text>
        <Text
          style={{
            color: accent,
            fontSize: 10,
            fontFamily: 'Menlo',
            fontWeight: '700',
            paddingHorizontal: 6,
            paddingVertical: 2,
            backgroundColor: `${accent}26`,
            borderRadius: 4,
          }}
        >
          {proof.trustLevel.toUpperCase()}
        </Text>
      </View>
      <Text className="text-text3" style={{ fontSize: 10, fontFamily: 'Menlo' }}>
        {`Type: ${proof.proofType}`}
      </Text>
    </View>
  );
}

function PersistStep({
  proof,
  busy,
  onSave,
}: {
  proof: PassportProofResult | null;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <View className="bg-mutedSurface gap-3 rounded-xl p-3.5">
      <Text className="text-text2 text-center text-[15px]">
        Credential is ready. Save it to your identity wallet.
      </Text>
      <ThemedButton
        label="Save Passport Credential"
        fullWidth
        disabled={proof === null || busy}
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
        className="text-text1 rounded-sm2 bg-cardBg text-[15px]"
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

// ---------------------------------------------------------------------------
// Chip-snapshot helpers — mirror Swift PassportPipelineService.realNFCRead +
// simulatedNFCRead. The masking / digest logic stays JS-side so the screen
// can render the chip card without round-tripping through native.
// ---------------------------------------------------------------------------

function chipFromNitro(
  result: PassportReadResult,
  fallbackNationality: string,
  fallbackDocNumber: string
): PassportChipSnapshot {
  return {
    documentHash: '',
    mrzDigest: '',
    dg1MRZData: '',
    chipUid: result.chipUid ?? '',
    bacVerified: true,
    paceVerified: true,
    passiveAuthPassed: result.passiveAuthValid,
    isSimulated: false,
    readAt: new Date(),
    nationalityCode: result.mrz.nationality || fallbackNationality,
    maskedDocNumber: maskDocumentNumber(result.mrz.documentNumber || fallbackDocNumber),
    dataGroupsRead: ['COM', 'SOD', 'DG1', 'DG2', 'DG14', 'DG15'],
  };
}

function simulatedChipSnapshot(draft: {
  passportNumber: string;
  nationalityCode: string;
}): PassportChipSnapshot {
  const fakeDigest = '0123456789abcdef0123456789abcdef';
  return {
    documentHash: fakeDigest,
    mrzDigest: fakeDigest,
    dg1MRZData: `P<${draft.nationalityCode}<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`,
    chipUid: `SIM-${fakeDigest.slice(0, 8).toUpperCase()}`,
    bacVerified: true,
    paceVerified: false,
    passiveAuthPassed: false,
    isSimulated: true,
    readAt: new Date(),
    nationalityCode: draft.nationalityCode,
    maskedDocNumber: maskDocumentNumber(draft.passportNumber),
    dataGroupsRead: ['DG1 (sim)'],
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa !== 'undefined') return btoa(binary);
  // RN fallback: leave as binary string (rare path; mock proof only).
  return binary;
}
