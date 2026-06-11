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
import { showError } from '@/feedback/appAlert';
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
  PASSPORT_NOIR_VERSION,
  PASSPORT_V3_PROOF_TYPE,
  bindPassportOpenAcV3DeviceSignature,
  buildPassportOpenAcV3ProofPlan,
  buildPassportOpenAcV3WitnessBundleJson,
  describePassportOpenAcV3Unavailable,
  generatePassportOpenAcV3ProofPayload,
  parsePassportOpenAcV3ActiveAuthJson,
  parsePassportOpenAcV3WitnessBundleJson,
  resolvePassportOpenAcV3WitnessBundleJson,
  shouldAllowPassportOpenAcV3FallbackProof,
  shouldPreparePassportOpenAcV3WitnessDuringRead,
  type PassportOpenAcV3ProofPlan,
} from '@/passport/openacV3';
import {
  derivePassportFingerprint,
  findPassportDuplicate,
  passportFingerprintTag,
} from '@/passport/persistence';
import {
  buildPassportErrorDetail,
  classifyPassportProofError,
  friendlyProofError,
  ZK_UNAVAILABLE_RE,
  type PassportErrorPhase,
} from '@/passport/diagnostics';
import {
  didKeyForCurrentIdentity,
  publicRawP256ForCurrentIdentity,
  signOpenAcDeviceBindingDigest,
} from '@/keychain';
import { usePreferences } from '@/settings/preferences';
import { useCredentialStore, type TrustLevel } from '@/credentials/store';
import { useActiveDid, useIdentityData } from '@/identity';
import type { ProvableClaimEntity } from '@/identity/entities';
import {
  getNfcPassport,
  type PassportReadResult,
} from '@solidarity/nitro-nfc-passport';
import { getPassportZk } from '@solidarity/nitro-passport-zk';
import { sha256Bytes, uuid } from '@solidarity/shared';

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

function loadBundledRevocationSnapshot(
  nfc: ReturnType<typeof getNfcPassport> | null
): unknown {
  if (nfc === null) return undefined;

  let snapshotJson: string;
  try {
    snapshotJson = nfc.getRevocationSnapshotJson();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[zk] passport revocation snapshot unavailable — ${message}`);
    return undefined;
  }

  try {
    return JSON.parse(snapshotJson);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[zk] passport revocation snapshot is not valid JSON — ${message}`);
    return { invalidPassportRevocationSnapshot: true };
  }
}

function freshOpenAcV3NonceHash(): Uint8Array {
  const bytes = new Uint8Array(32);
  const cryptoLike = (globalThis as {
    crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  }).crypto;
  if (typeof cryptoLike?.getRandomValues === 'function') {
    cryptoLike.getRandomValues(bytes);
    return bytes;
  }
  return sha256Bytes(`airmeishi-openac-v3:${uuid()}:${String(Date.now())}`);
}

function hasDataGroupBytes(value: ArrayBuffer | undefined): boolean {
  return value !== undefined && value.byteLength > 0;
}

function hasOpenAcV3ActiveAuthentication(result: {
  readonly dataGroups?: PassportReadResult['dataGroups'];
  readonly activeAuthJson?: string;
}): boolean {
  return (
    hasDataGroupBytes(result.dataGroups?.dg15) &&
    parsePassportOpenAcV3ActiveAuthJson(result.activeAuthJson) !== null
  );
}

async function attachOpenAcV3WitnessDuringRead(args: {
  readonly result: PassportReadResult;
  readonly nfc: ReturnType<typeof getNfcPassport> | null;
  readonly zk: ReturnType<typeof getPassportZk> | null;
  readonly setProgress: () => void;
}): Promise<PassportReadResult> {
  if (args.result.openAcV3WitnessBundleJson) return args.result;

  const skip = (reason: string): PassportReadResult => {
    console.warn(`[zk] OpenAC v3 read-stage witness skipped — ${reason}`);
    return args.result;
  };

  const revocationSnapshot = loadBundledRevocationSnapshot(args.nfc);
  const witnessDecision = shouldPreparePassportOpenAcV3WitnessDuringRead({
    ...args.result,
    revocationSnapshot,
  });
  if (args.zk === null) {
    return skip(
      `passport-noir ${PASSPORT_NOIR_VERSION} witness builder is not linked.`
    );
  }
  if (!witnessDecision.prepare) {
    return skip(describePassportOpenAcV3Unavailable(witnessDecision.plan, false));
  }

  const activeAuth = parsePassportOpenAcV3ActiveAuthJson(args.result.activeAuthJson);
  const requireAA = hasDataGroupBytes(args.result.dataGroups?.dg15) && activeAuth !== null;

  args.setProgress();
  try {
    const witnessBundleJson = await buildPassportOpenAcV3WitnessBundleJson({
      chip: args.result,
      revocationSnapshot: witnessDecision.plan.revocationSnapshot,
      devicePublicKeyRaw: await publicRawP256ForCurrentIdentity(),
      nonceHash: freshOpenAcV3NonceHash(),
      linkScope: 'airmeishi-passport-v3',
      requireAA,
      activeAuth: requireAA ? activeAuth : undefined,
      builder: args.zk,
    });
    return {
      ...args.result,
      openAcV3WitnessBundleJson: witnessBundleJson,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return skip(message);
  }
}

/**
 * Map the passport pipeline's string trustLevel ('green'/'blue'/'white')
 * to the entity-level discriminated union ('L1'/'L2'/'L3') the
 * identity/credentials stores use. Mirrors the inverse mapper in
 * `app/(tabs)/me/index.tsx`. `'white'` = synthetic / SD-JWT-only =
 * Level 1. `'blue'` = passive-authenticated passport_v3 without DG15/AA =
 * Level 2. `'green'` = passport_v3 with DG15 Active Authentication =
 * Level 3.
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

async function findSavedPassportDuplicate(fingerprint: string) {
  await useCredentialStore.getState().hydrate();
  await useIdentityData.getState().hydrate();

  const identityDuplicate = findPassportDuplicate(
    fingerprint,
    useIdentityData.getState().identityCards
  );
  if (identityDuplicate) return identityDuplicate;

  return findPassportDuplicate(
    fingerprint,
    Array.from(useCredentialStore.getState().details.values())
  );
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
      reportPassportError({
        context: 'Passport › NFC Read',
        phase: 'nfc-read',
        summary: nfcStrategy.message,
        error: nfcStrategy.message,
      });
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
    let diagnosticResult: PassportReadResult | null = null;
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
        diagnosticResult = result;
        const resultWithWitness = await attachOpenAcV3WitnessDuringRead({
          result,
          nfc: nitro.nfc,
          zk: nitro.zk,
          setProgress: () => {
            dispatch({
              type: 'setNfcProgressEvent',
              phase: 'verifying',
              percent: 96,
              message: 'Preparing OpenAC v3 witness...',
            });
          },
        });
        diagnosticResult = resultWithWitness;
        chip = chipFromNitro(
          resultWithWitness,
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
      dispatch({
        type: 'setNfcProgressEvent',
        phase: 'error',
        percent: 0,
        message: 'Passport NFC read failed.',
      });
      reportPassportError({
        context: 'Passport › NFC Read',
        phase: 'nfc-read',
        summary: 'Could not read the passport NFC chip.',
        error: err,
        chip: diagnosticResult,
      });
    } finally {
      dispatch({ type: 'setLoading', value: false });
    }
  };

  const onGenerateProof = async () => {
    if (!state.chip) return;
    let proofChip = state.chip;
    try {
      const passportFingerprint = derivePassportFingerprint(state.draft);
      const duplicate = await findSavedPassportDuplicate(passportFingerprint);
      if (duplicate) {
        pushToast(
          'This passport credential is already saved. Delete the existing passport before scanning it again.',
          'warning'
        );
        return;
      }
      dispatch({ type: 'setLoading', value: true });
      dispatch({ type: 'setProofProgress', message: 'Initializing prover...' });
      let proof: PassportProofResult;
      const proofPlan = buildPassportOpenAcV3ProofPlan({
        ...proofChip,
        revocationSnapshot: loadBundledRevocationSnapshot(nitro.nfc),
      });
      const witnessBundleJson =
        proofPlan.kind === 'openac-v3' && nitro.zk && !proofChip.isSimulated
          ? await resolvePassportOpenAcV3WitnessBundleJson({
              existingWitnessBundleJson: proofChip.openAcV3WitnessBundleJson,
              chip: proofChip,
              revocationSnapshot: proofPlan.revocationSnapshot,
              devicePublicKeyRaw: await publicRawP256ForCurrentIdentity(),
              nonceHash: freshOpenAcV3NonceHash(),
              linkScope: 'airmeishi-passport-v3',
              builder: nitro.zk,
            })
          : proofChip.openAcV3WitnessBundleJson;
      if (witnessBundleJson && witnessBundleJson !== proofChip.openAcV3WitnessBundleJson) {
        proofChip = { ...proofChip, openAcV3WitnessBundleJson: witnessBundleJson };
        dispatch({ type: 'setChip', chip: proofChip });
      }
      const zkProof =
        proofPlan.kind === 'openac-v3' && nitro.zk && !proofChip.isSimulated
          ? await tryGenerateOpenAcV3Proof(
              nitro.zk,
              proofPlan,
              witnessBundleJson,
              (m) => {
                dispatch({ type: 'setProofProgress', message: m });
              },
            )
          : null;
      if (zkProof !== null) {
        proof = {
          // Real passport-noir 0.3.0 proof. Trust upgrades to green only
          // when OpenAC v3 prepare + show have both verified against a real,
          // passive-authenticated chip read.
          proofType: PASSPORT_V3_PROOF_TYPE,
          proofPayload: zkProof.proofPayload,
          trustLevel: hasOpenAcV3ActiveAuthentication(proofChip) ? 'green' : 'blue',
          generationFailed: false,
          disclosure: null,
        };
      } else {
        const fallbackReason = describePassportOpenAcV3Unavailable(
          proofPlan,
          nitro.zk === null
        );
        console.warn(`[zk] OpenAC v3 unavailable — ${fallbackReason}`);
        if (!shouldAllowPassportOpenAcV3FallbackProof(proofChip)) {
          throw new Error(fallbackReason);
        }
        dispatch({
          type: 'setProofProgress',
          message: 'OpenAC v3 unavailable — using SD-JWT fallback…',
        });
        pushToast('OpenAC v3 unavailable — using SD-JWT fallback.', 'info');
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
      reportPassportError({
        context: 'Passport › Generate Proof',
        phase: 'proof-generation',
        summary: friendlyProofError(err),
        error: err,
        chip: proofChip,
        code: classifyPassportProofError(err),
      });
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
    dispatch({ type: 'setLoading', value: true });
    try {
      const draft = state.draft;
      const chip = state.chip;
      const proof = state.proof;

      const trustLevel = mapTrustLevel(proof.trustLevel);
      const passportFingerprint = derivePassportFingerprint(draft);
      const duplicate = await findSavedPassportDuplicate(passportFingerprint);
      if (duplicate) {
        pushToast(
          'This passport credential is already saved. Delete the existing passport before scanning it again.',
          'warning'
        );
        return;
      }
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
      const metadataTags: string[] = [passportFingerprintTag(passportFingerprint)];
      if (proof.proofType === PASSPORT_V3_PROOF_TYPE) {
        metadataTags.push('passport-openac-v3', 'passport-noir');
        if (proof.trustLevel === 'blue') metadataTags.push('passport-openac-v3-no-aa');
      }
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reportPassportError({
        context: 'Passport › Save Credential',
        phase: 'persist',
        summary: message.split('\n')[0] ?? 'Failed to save passport credential',
        error: err,
        chip: state.chip,
      });
    } finally {
      dispatch({ type: 'setLoading', value: false });
    }
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
          <PersistStep proof={state.proof} busy={state.isLoading} onSave={() => { void onPersist(); }} />
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

async function tryGenerateOpenAcV3Proof(
  zk: NonNullable<ReturnType<typeof getPassportZk>>,
  plan: Extract<PassportOpenAcV3ProofPlan, { kind: 'openac-v3' }>,
  witnessBundleJson: string | undefined,
  setProgress: (message: string) => void,
): Promise<{ proofPayload: string } | null> {
  const witnessBundle = parsePassportOpenAcV3WitnessBundleJson(witnessBundleJson);
  if (witnessBundle === null) {
    console.log(
      `[zk] passport-noir ${PASSPORT_NOIR_VERSION} OpenAC v3 skipped — witness inputs missing or invalid`,
    );
    return null;
  }

  // Device-binding signature is biometric-gated like every other signing
  // op (CLAUDE.md Sec rule). The `'sign'` grace means one Face ID covers
  // this whole proof session — and any recent sign (share / QR) is reused,
  // so the user is not re-prompted mid-flow.
  const deviceBound = await bindPassportOpenAcV3DeviceSignature(
    witnessBundle,
    signOpenAcDeviceBindingDigest
  );
  if (!deviceBound.ready) {
    console.log(
      `[zk] passport-noir ${PASSPORT_NOIR_VERSION} OpenAC v3 skipped — ${deviceBound.reason}`,
    );
    return null;
  }

  setProgress(`Generating passport-noir ${PASSPORT_NOIR_VERSION} OpenAC proof…`);
  const startedAt = Date.now();
  try {
    const generated = await generatePassportOpenAcV3ProofPayload({
      plan,
      witnesses: deviceBound.witnesses,
      prover: zk,
      encodeProofBytes: arrayBufferToBase64,
      onProgress: ({ phase, circuit }) => {
        const verb = phase === 'generate' ? 'Generating' : 'Verifying';
        setProgress(`${verb} ${circuit.name} proof…`);
        if (phase === 'generate') {
          console.log(`[zk] generateNoirProof start — circuit=${circuit.name}`);
        }
      },
    });
    const circuitNames = generated.proofs.map((proof) => proof.circuit).join(',');
    console.log(
      `[zk] OpenAC v3 proof bundle ok in ${String(Date.now() - startedAt)}ms — circuits=${circuitNames}`,
    );
    return {
      proofPayload: generated.proofPayload,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `[zk] OpenAC v3 proof failed in ${String(Date.now() - startedAt)}ms — ${message}`,
    );
    if (ZK_UNAVAILABLE_RE.test(message)) {
      console.log('[zk] error matches native-unavailable regex — OpenAC v3 unavailable');
      return null;
    }
    throw err;
  }
}

function reportPassportError(args: {
  readonly context: string;
  readonly phase: PassportErrorPhase;
  readonly summary: string;
  readonly error: unknown;
  readonly chip?: PassportReadResult | PassportChipSnapshot | null;
  readonly code?: string;
}): void {
  showError({
    context: args.context,
    summary: args.summary,
    code: args.code,
    error: buildPassportErrorDetail({
      phase: args.phase,
      error: args.error,
      chip: args.chip,
    }),
  });
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
