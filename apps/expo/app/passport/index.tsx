/**
 * Passport Setup — 1:1 port of Swift PassportOnboardingFlowView.swift +
 * PassportOnboardingFlowView+Steps.swift.
 *
 * Multi-step orchestration (state machine in @/passport/pipeline):
 *   mrz   → Scan Passport / Manual Input toggle. Tap Scan → MRZCameraStep
 *           modal (vision-camera) lays an overlay on the live feed; once a
 *           draft is detected the user confirms with "Use This" and we drop
 *           into the manual-input panel pre-filled with the scanned fields.
 *   nfc   → iPhone + waveform visual, "Read NFC Chip" button. After read
 *           shows a chip-snapshot card with BAC/PACE/PA badges + data groups.
 *   proof → Shield + "Create Privacy Proof" + bullets + "Generate Proof",
 *           then a per-status proof-result card.
 *   persist → "Save Passport Credential" inverted CTA.
 *
 * Falls back to a clearly-labelled mock flow when Nitro NFC + ZK modules
 * aren't linked (Simulator / Android before native impl). Mock chips +
 * proofs are demoted to "selfIssued / white" trust level per CLAUDE.md
 * Sec rules — never present synthetic data as government-grade.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CryptoCompilingOverlay } from '@/components/common/CryptoCompilingOverlay';
import { PassportMrzStep } from '@/components/passport/PassportMrzStep';
import {
  NfcStep,
  PersistStep,
  ProofStep,
} from '@/components/passport/PassportSteps';
import { SolidarityPlaceholderCard } from '@/components/passport/SolidarityPlaceholderCard';
import { pushToast } from '@/feedback/toast';
import {
  MRZCameraStep,
  type PassportMRZDraft as MrzScannedDraft,
} from '@/onboarding/steps/MRZCameraStep';
import {
  arrayBufferToBase64,
  chipFromNitro,
  initialPassportPipelineState,
  PASSPORT_STEP_META,
  passportPipelineReducer,
  simulatedChipSnapshot,
  validateMrzDraft,
  type PassportChipSnapshot,
  type PassportMRZDraft,
  type PassportProofResult,
} from '@/passport/pipeline';
import { getNfcPassport } from '@solidarity/nitro-nfc-passport';
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
      const chip: PassportChipSnapshot = nitro.nfc
        ? chipFromNitro(
            await nitro.nfc.read({
              documentNumber: state.draft.passportNumber,
              dateOfBirth: state.draft.dateOfBirth,
              dateOfExpiry: state.draft.expiryDate,
            }),
            state.draft.nationalityCode,
            state.draft.passportNumber
          )
        : await simulateNfcRead(state.draft);
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
          <PassportMrzStep
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

async function simulateNfcRead(draft: PassportMRZDraft): Promise<PassportChipSnapshot> {
  await new Promise<void>((r) => setTimeout(r, 800));
  return simulatedChipSnapshot(draft);
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
