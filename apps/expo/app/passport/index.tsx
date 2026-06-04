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
 * The NFC read path is chosen by `selectNfcReadStrategy`:
 *   - `real`        — production build with the Nitro bridge linked and
 *                     Core NFC available (physical iPhone). No fallback.
 *   - `simulated`   — developer-mode-only mock. Requires BOTH
 *                     `developerMode` AND `simulateNfc` flags so a
 *                     toggle-flick alone never substitutes a fake chip.
 *   - `unavailable` — typed error surfaced to the toast bar (Simulator
 *                     without dev mode, or Nitro module unlinked).
 *
 * Mock chips + proofs are demoted to "selfIssued / white" trust level per
 * CLAUDE.md Sec rules — never present synthetic data as government-grade.
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
import { notifyPassportOnboardingCompleted } from '@/onboarding/passportHandoff';
import {
  arrayBufferToBase64,
  chipFromNitro,
  initialPassportPipelineState,
  PASSPORT_STEP_META,
  passportPipelineReducer,
  selectNfcReadStrategy,
  simulatedChipSnapshot,
  validateMrzDraft,
  type PassportChipSnapshot,
  type PassportMRZDraft,
  type PassportProofResult,
} from '@/passport/pipeline';
import {
  buildDisclosureWitness,
  DEFAULT_DISCLOSURE_POLICY,
} from '@/passport/zkInputs';
import { didKeyForCurrentIdentity } from '@/keychain';
import { usePreferences } from '@/settings/preferences';
import { useCredentialStore, type TrustLevel } from '@/credentials/store';
import { useActiveDid, useIdentityData } from '@/identity';
import type { ProvableClaimEntity } from '@/identity/entities';
import { getNfcPassport } from '@solidarity/nitro-nfc-passport';
import { getPassportZk } from '@solidarity/nitro-passport-zk';
import { uuid } from '@solidarity/shared';

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

/**
 * Map the passport pipeline's string trustLevel ('green'/'blue'/'white')
 * to the entity-level discriminated union ('L1'/'L2'/'L3') the
 * identity/credentials stores use. Mirrors the inverse mapper in
 * `app/(tabs)/me/index.tsx`. `'white'` = synthetic / SD-JWT-only =
 * Level 1. `'blue'` = ZK fallback path = Level 2. `'green'` = real ZK
 * proof on real chip = Level 3.
 */
function mapTrustLevel(passportLevel: string): TrustLevel {
  switch (passportLevel) {
    case 'green':
      return 'L3';
    case 'blue':
      return 'L2';
    default:
      return 'L1';
  }
}

/**
 * Parse a YYMMDD MRZ date into a JS Date in UTC. Returns null on
 * malformed input so the credential just doesn't get an expiry field
 * rather than ending up with `Invalid Date`. Years 00..69 map to
 * 2000..2069, 70..99 map to 1970..1999 — the ICAO 9303 sliding window.
 */
function parseMrzYyMmDd(yymmdd: string): Date | null {
  if (yymmdd.length !== 6) return null;
  const yy = Number.parseInt(yymmdd.slice(0, 2), 10);
  const mm = Number.parseInt(yymmdd.slice(2, 4), 10);
  const dd = Number.parseInt(yymmdd.slice(4, 6), 10);
  if (Number.isNaN(yy) || Number.isNaN(mm) || Number.isNaN(dd)) return null;
  const year = yy <= 69 ? 2000 + yy : 1900 + yy;
  const d = new Date(Date.UTC(year, mm - 1, dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

export default function PassportSetup() {
  const params = useLocalSearchParams<{ manual?: string; from?: string }>();
  const fromOnboarding = params.from === 'onboarding';
  const insets = useSafeAreaInsets();
  const activeDid = useActiveDid();
  const [state, dispatch] = useReducer(passportPipelineReducer, initialPassportPipelineState);
  const [showManualInput, setShowManualInput] = useState(params.manual === '1');
  const [showCamera, setShowCamera] = useState(false);

  const meta = PASSPORT_STEP_META[state.step];
  const nitro = useMemo(() => tryLoadNitro(), []);
  const developerMode = usePreferences((s) => s.developerMode);
  const simulateNfc = usePreferences((s) => s.simulateNfc);
  // Mirrors Swift `PassportPipelineService.shouldSimulateNFC` — pick `real`,
  // `simulated` (developer-mode only), or `unavailable` (production w/o a
  // working bridge). No silent mock substitution — `unavailable` surfaces a
  // typed message to the toast bar instead of returning fake chip data.
  const nfcStrategy = useMemo(
    () =>
      selectNfcReadStrategy({
        nitroLinked: nitro.nfc !== null,
        hardwareAvailable: nitro.nfc?.isAvailable() ?? false,
        developerMode,
        simulateNfc,
      }),
    [nitro.nfc, developerMode, simulateNfc]
  );
  const isMock = nfcStrategy.kind === 'simulated' || nitro.zk === null;

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
    if (nfcStrategy.kind === 'unavailable') {
      dispatch({ type: 'setError', message: nfcStrategy.message });
      return;
    }
    dispatch({ type: 'setLoading', value: true });
    dispatch({
      type: 'setNfcProgressEvent',
      phase: nfcStrategy.kind === 'simulated' ? 'connecting' : 'connecting',
      percent: 0,
      message:
        nfcStrategy.kind === 'simulated'
          ? 'Simulating chip read (developer mode)...'
          : 'Hold passport near device...',
    });
    try {
      let chip: PassportChipSnapshot;
      if (nfcStrategy.kind === 'simulated') {
        chip = await simulateNfcRead(state.draft);
      } else {
        // Production path — talk to the real chip via Nitro. No fallback:
        // any error (cancellation, tag-lost, BAC/PACE failure) bubbles up
        // unchanged so the user sees the underlying NFCPassportReader
        // failure, not a faked green-checkmark snapshot.
        const nfcReader = nitro.nfc;
        if (nfcReader === null) {
          throw new Error(
            'NFC passport reader is not linked. Rebuild with `pod install`.'
          );
        }
        const result = await nfcReader.read(
          {
            documentNumber: state.draft.passportNumber,
            dateOfBirth: state.draft.dateOfBirth,
            dateOfExpiry: state.draft.expiryDate,
          },
          {
            // The JS pipeline only consumes DG1 today — dropping DG2 (the
            // ~15-30KB face JPEG) halves typical read time (~5-8s → ~2-3s).
            // Flip back to false when face matching ships.
            skipFaceImage: true,
            onProgress: (event) => {
              dispatch({
                type: 'setNfcProgressEvent',
                phase: event.phase,
                percent: event.percent,
                message: event.message ?? '',
              });
            },
          },
        );
        chip = chipFromNitro(
          result,
          state.draft.nationalityCode,
          state.draft.passportNumber
        );
      }
      dispatch({
        type: 'setNfcProgressEvent',
        phase: 'done',
        percent: 100,
        message: 'Read complete.',
      });
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
      // Build the v3 disclosure witness from real chip MRZ + the default
      // KYC policy (disclose nationality + age ≥ 18, hide name). Anything
      // malformed (e.g. MRZ length mismatch) throws synchronously here so
      // the user sees a typed JS error, not a Rust witness-shape failure.
      const built = buildDisclosureWitness(state.chip, DEFAULT_DISCLOSURE_POLICY);
      // Gate the ZK prover on a real chip read. `simulatedChipSnapshot`
      // returns `P<{nat}<<<...` with all `<` filler in the DOB slot
      // (mrz_data[57..62]). Feeding that to the disclosure circuit makes
      // its age computation overflow (`100 + 26 - 132` in u16) and the
      // constraint asserts fail with "Failed assertion" inside
      // barretenberg — surfacing as a useless toast for the user even
      // though the prover itself is fine. With no real chip, SD-JWT
      // (white trust) is the only honest path (CLAUDE.md rule 8).
      const zkProof = nitro.zk && !state.chip.isSimulated
        ? await tryGenerateZkProof(
            nitro.zk,
            built.inputsJson,
            (m) => {
              dispatch({ type: 'setProofProgress', message: m });
            },
          )
        : null;
      if (zkProof !== null) {
        proof = {
          // Real v3 disclosure proof. Trust upgrades to `green` only when
          // the chip wasn't simulated — a synthetic MRZ still produces a
          // valid ZK proof but should not be claimed as attestation
          // (CLAUDE.md rule 8).
          proofType: 'mopro-noir-disclosure',
          proofPayload: arrayBufferToBase64(zkProof.proof),
          trustLevel: state.chip.isSimulated ? 'white' : 'green',
          generationFailed: false,
          disclosure: {
            nationality: built.disclosedNationality,
            name: built.disclosedName,
            isOlder: built.isOlder,
            ageThreshold: built.ageThreshold,
            mrzHashHex: built.mrzHashHex,
          },
        };
      } else {
        // ZK prover is unavailable for one of three reasons:
        //   1. No ZK module linked (legacy build, missing .so)
        //   2. Native cdylib loaded but its libc++ symbol set clashes with
        //      the libc++_shared.so AGP picked for the APK (the common
        //      Path-1+ failure mode — barretenberg references hidden
        //      libc++ template VTTs that NDK r25+ doesn't export)
        //   3. The cdylib loaded fine but threw the legacy stub
        // All three surface a "use SD-JWT" toast so the user reaches the
        // persist step; the `white` trust level + `generationFailed: true`
        // tag the credential as fallback in ProofResultCard.
        dispatch({ type: 'setProofProgress', message: 'ZK prover unavailable — using fallback…' });
        if (nitro.zk) {
          pushToast(
            "ZK prover can't load on this device — using SD-JWT fallback.",
            'info',
          );
        }
        await new Promise<void>((r) => setTimeout(r, 600));
        proof = {
          proofType: 'sd-jwt-fallback',
          proofPayload: 'demo.vc.jwt',
          trustLevel: 'white',
          generationFailed: true,
        };
      }
      dispatch({ type: 'setProof', proof });
    } catch (err) {
      dispatch({ type: 'setError', message: friendlyProofError(err) });
    } finally {
      dispatch({ type: 'setLoading', value: false });
    }
  };

  const onPersist = async () => {
    // 1:1 port of Swift PassportPipelineService.persistProof (lines
    // 150-225 in solidarity/Services/Identity/PassportPipelineService.swift).
    // Persists the verified credential AND seeds the three provable
    // claims (age_over_18 / is_human / field_name) so the Me page's
    // Selective Disclosures section actually populates with the
    // chunked-QR / age-QR / true-human-QR rows. Before this fix the
    // RN persist step was a toast-only stub which is why the user
    // saw zero credentials and zero disclosures even after a
    // successful end-to-end ZK passport scan.
    if (!state.draft || !state.chip || !state.proof) {
      pushToast('Passport flow not complete', 'warning');
      return;
    }
    const draft = state.draft;
    const chip = state.chip;
    const proof = state.proof;

    const trustLevel = mapTrustLevel(proof.trustLevel);
    const cardId = uuid();
    const now = new Date();
    const issuerType = chip.isSimulated ? 'selfIssued' : 'government';
    const issuerDid = chip.isSimulated
      ? `did:self:passport:${cardId}`
      : `did:gov:passport:${draft.nationalityCode}`;
    // FAIL CLOSED on the holder binding — 1:1 with Swift
    // PassportPipelineService.persistProof (lines 132-141): if the master
    // signing key has not resolved yet (e.g. iCloud Keychain not synced),
    // NEVER fabricate a `did:key:${cardId}` placeholder. That UUID is not
    // derived from any key, so the credential would look valid in lists /
    // presentation but cannot be cryptographically bound to the user — it
    // "poisons the vault". Resolve the real signing-key DID and abort if it
    // is unavailable so the user re-tries after sync.
    let holderDid = activeDid;
    if (holderDid == null || holderDid.length === 0) {
      try {
        holderDid = await didKeyForCurrentIdentity();
      } catch {
        holderDid = null;
      }
    }
    if (holderDid == null || holderDid.length === 0) {
      pushToast(
        'Identity key not ready — wait for iCloud Keychain sync, then retry.',
        'error'
      );
      return;
    }
    const expiry = parseMrzYyMmDd(draft.expiryDate);
    const metadataTags: string[] = [];
    if (proof.proofType.startsWith('mopro-noir')) metadataTags.push('mopro-noir');
    if (proof.proofType.startsWith('semaphore')) metadataTags.push('semaphore-zk');
    if (proof.proofType === 'sd-jwt-fallback') metadataTags.push('sd-jwt-fallback');
    if (chip.isSimulated) metadataTags.push('simulated');
    if (proof.generationFailed) metadataTags.push('fallback');

    await useCredentialStore.getState().add({
      id: cardId,
      type: 'passport',
      title: chip.isSimulated ? 'Passport (dev-mode)' : 'Passport',
      issuerDid,
      holderDid,
      trustLevel,
      rawJwt: proof.proofPayload,
      issuedAt: now,
      ...(expiry ? { expiresAt: expiry } : {}),
      metadataTags,
    });

    await useIdentityData.getState().upsertIdentityCard({
      id: cardId,
      type: 'passport',
      issuerType,
      trustLevel,
      title: chip.isSimulated ? 'Passport (dev-mode)' : 'Passport',
      issuerDid,
      holderDid,
      issuedAt: now,
      ...(expiry ? { expiresAt: expiry } : {}),
      status: proof.generationFailed
        ? 'fallback'
        : chip.isSimulated
        ? 'simulated'
        : 'verified',
      sourceReference: chip.isSimulated ? 'MRZ+NFC(simulated)' : 'MRZ+NFC',
      rawCredentialJWT: proof.proofPayload,
      metadataTags,
      createdAt: now,
      updatedAt: now,
    });

    const claimPayload = (claim: string): string => {
      const parts: string[] = [
        `"claim":"${claim}"`,
        `"proof":"${proof.proofType}"`,
        `"identity_card_id":"${cardId}"`,
      ];
      if (chip.isSimulated) parts.push(`"is_simulated":true`);
      return `{${parts.join(',')}}`;
    };
    const claims: ProvableClaimEntity[] = [
      {
        id: uuid(),
        identityCardId: cardId,
        claimType: 'age_over_18',
        title: 'I am over 18',
        issuerType,
        trustLevel,
        source: 'Passport',
        payload: claimPayload('age_over_18'),
        isPresentable: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuid(),
        identityCardId: cardId,
        claimType: 'is_human',
        title: 'I am a real person',
        issuerType,
        trustLevel,
        source: 'Passport',
        payload: claimPayload('is_human'),
        isPresentable: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: uuid(),
        identityCardId: cardId,
        claimType: 'field_name',
        title: chip.isSimulated
          ? 'Name (dev-mode passport)'
          : 'Name verified by passport',
        issuerType,
        trustLevel,
        source: 'Passport',
        payload: claimPayload('field_name'),
        sourceField: 'name',
        isPresentable: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
    for (const c of claims) {
      await useIdentityData.getState().upsertProvableClaim(c);
    }

    pushToast(
      chip.isSimulated
        ? 'Mock passport credential issued (demo only)'
        : 'Passport credential issued',
      'success',
    );
    // Mirror Swift's `onCompleted(proof)` closure: when this flow was launched
    // from onboarding, signal completion so the wizard sets passportScanned and
    // advances to the `complete` step. The listener runs synchronously, so
    // onboarding is already on `complete` before router.back() reveals it.
    if (fromOnboarding) notifyPassportOnboardingCompleted();
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
            progressPercent={state.nfcProgressPercent}
            progressPhase={state.nfcProgressPhase}
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

/**
 * Errors we treat as "the ZK prover is unavailable on this build" and
 * route to the SD-JWT fallback rather than show as an error toast.
 *
 *   1. The legacy stub throw from the pre-Path-1 cdylib placeholder.
 *   2. JNA `UnsatisfiedLinkError` from a `dlopen` failure on the cdylib —
 *      most commonly NDK r25+'s `_LIBCPP_HIDE_FROM_ABI` mismatch where the
 *      libc++_shared.so picked by AGP doesn't expose VTTs that barretenberg
 *      pulls in (`_ZTT…basic_ostringstream…`). The cdylib is in the APK,
 *      but the runtime can't actually use it.
 *   3. Explicit "Native ZK library failed to load" from our own Kotlin
 *      catch-block wrapper, also from a dlopen failure.
 *
 * Real proof-time errors (circuit missing, witness shape mismatch,
 * out-of-memory, etc.) still bubble up unchanged so the user sees them.
 */
const ZK_UNAVAILABLE_RE =
  /passport-zk Android impl not linked|build libpassport_zk_mopro\.so first|UnsatisfiedLinkError|Native ZK library failed to load|cannot locate symbol/i;
/** @deprecated alias retained for grep; use `ZK_UNAVAILABLE_RE`. */
const ZK_NOT_LINKED_RE = ZK_UNAVAILABLE_RE;

/**
 * Run the Nitro ZK prover. Real prover errors (memory, malformed inputs,
 * circuit not bundled, etc.) re-throw verbatim so the JS layer can show
 * them; only the legacy stub throw is treated as a soft `null` to keep
 * older-APK installs running through the SD-JWT path.
 */
async function tryGenerateZkProof(
  zk: NonNullable<ReturnType<typeof getPassportZk>>,
  inputsJson: string,
  setProgress: (message: string) => void,
): Promise<{ proof: ArrayBuffer } | null> {
  setProgress('Generating ZK proof (~5–15s)…');
  console.log('[zk] generateNoirProof start — inputs:', inputsJson.length, 'chars');
  const startedAt = Date.now();
  try {
    // Empty `circuitPath` / `undefined` SRS resolve to the bundled
    // disclosure assets on Android (see HybridPassportZk.kt
    // resolveCircuitPath / resolveSrsPath). iOS will need the matching
    // bundle wiring in MoproShim.swift before this works there.
    const result = await zk.generateNoirProof('', undefined, inputsJson);
    console.log(
      `[zk] generateNoirProof ok in ${String(Date.now() - startedAt)}ms — proof=${String(result.proof.byteLength)}B vk=${String(result.vk.byteLength)}B`,
    );
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `[zk] generateNoirProof failed in ${String(Date.now() - startedAt)}ms — ${message}`,
    );
    if (ZK_NOT_LINKED_RE.test(message)) {
      console.log('[zk] error matches legacy stub regex — falling back to SD-JWT');
      return null;
    }
    throw err;
  }
}

/**
 * Sanitises proof-generation errors before they reach the toast/Alert so
 * Android users never see raw `java.lang.…` stack traces (rule 8 spirit:
 * surface honest UX state, not implementation noise).
 */
function friendlyProofError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (ZK_NOT_LINKED_RE.test(raw)) {
    return 'ZK prover not yet built for this device — try again or use the SD-JWT fallback.';
  }
  // Trim any embedded stack trace so the toast stays one line.
  return raw.split('\n')[0] ?? 'Proof generation failed';
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
