/**
 * Passport pipeline — mirrors Swift PassportPipelineService.swift +
 * PassportPipelineViewModel.swift (combined into one TS surface).
 *
 * The state machine matches Swift verbatim:
 *
 *   mrz ──validateMRZ──→ nfc ──readNFCChip──→ proof ──generateProof──→ persist
 *
 * Each transition is gated by the previous artifact:
 *   - mrz     → needs a validated PassportMRZDraft
 *   - nfc     → needs a PassportChipSnapshot (real or simulated)
 *   - proof   → needs a PassportProofResult (mopro-noir / semaphore / sd-jwt)
 *   - persist → issues IdentityCardEntity (handled by the calling screen)
 *
 * The exported `runPassportPipeline` function keeps the old one-shot API
 * for tests/scripts. Callers that need step-level UI control use the
 * `createPassportPipeline()` factory which returns a reducer + helpers.
 */
import type { CardError, Result } from '@solidarity/shared';
import { err, ok } from '@solidarity/shared';
import type {
  PassportMRZ,
  PassportReadResult,
} from '@solidarity/nitro-nfc-passport';

// ---------------------------------------------------------------------------
// Chip-snapshot helpers — mirror Swift PassportPipelineService.realNFCRead +
// simulatedNFCRead. Live here (not in the React page) so the masking /
// digest logic can be unit-tested without spinning up the Nitro bridge.
// ---------------------------------------------------------------------------

export type PassportPipelineStep = 'mrz' | 'nfc' | 'proof' | 'persist';

export interface PassportMRZDraft {
  readonly passportNumber: string;
  readonly nationalityCode: string;
  /** YYMMDD per ICAO 9303. */
  readonly dateOfBirth: string;
  /** YYMMDD per ICAO 9303. */
  readonly expiryDate: string;
}

export interface PassportChipSnapshot {
  readonly documentHash: string;
  readonly mrzDigest: string;
  readonly mrz: PassportReadResult['mrz'];
  readonly dg1MRZData: string;
  readonly dataGroups?: PassportReadResult['dataGroups'];
  readonly chipUid: string;
  readonly bacVerified: boolean;
  readonly paceVerified: boolean;
  readonly passiveAuthValid: boolean;
  readonly passiveAuthPassed: boolean;
  readonly isSimulated: boolean;
  readonly readAt: Date;
  readonly nationalityCode: string;
  readonly maskedDocNumber: string;
  readonly dataGroupsRead: readonly string[];
  readonly openAcV3WitnessBundleJson?: string;
  readonly activeAuthJson?: string;
}

/**
 * Public attributes the verifier sees alongside the retired disclosure
 * proof. Kept for legacy payloads; passport-noir 0.3.0 uses OpenAC v3
 * proof envelopes instead.
 */
export interface PassportDisclosure {
  /** 3-letter ICAO code, or null if the user opted to hide nationality. */
  readonly nationality: string | null;
  /** Display name (given + surname), or null if hidden. */
  readonly name: string | null;
  /** True if `age >= ageThreshold` was proven, null if hidden. */
  readonly isOlder: boolean | null;
  /** Threshold the prover committed to (e.g. 18). */
  readonly ageThreshold: number;
  /** Hex of `mrz_hash` — public anchor for chaining to a verify proof. */
  readonly mrzHashHex: string;
}

export interface PassportProofResult {
  readonly proofType: string;
  readonly proofPayload: string;
  readonly trustLevel: string;
  readonly generationFailed: boolean;
  /**
   * Legacy disclosure outputs. Null for passport-noir 0.3.0 OpenAC proofs,
   * SD-JWT fallback, or any non-disclosure proof path.
   */
  readonly disclosure?: PassportDisclosure | null;
}

export interface ValidationError {
  readonly kind: 'validation';
  readonly message: string;
}

/**
 * Validate the user-entered MRZ draft. Mirrors Swift
 * `PassportPipelineService.validateMRZ` (passport ≥ 6 chars,
 * 3-letter nationality, expiry > today).
 */
export function validateMrzDraft(draft: PassportMRZDraft): ValidationError | null {
  const passport = draft.passportNumber.trim();
  const nationality = draft.nationalityCode.trim();
  if (passport.length < 6) {
    return { kind: 'validation', message: 'Passport number is too short.' };
  }
  if (nationality.length !== 3) {
    return { kind: 'validation', message: 'Nationality code must be 3 letters.' };
  }
  const expiryDate = parseYyMmDd(draft.expiryDate);
  if (expiryDate && expiryDate.getTime() <= Date.now()) {
    return { kind: 'validation', message: 'Passport appears to be expired.' };
  }
  return null;
}

function parseYyMmDd(s: string): Date | null {
  if (s.length !== 6) return null;
  const yy = Number(s.slice(0, 2));
  const mm = Number(s.slice(2, 4));
  const dd = Number(s.slice(4, 6));
  if (Number.isNaN(yy) || Number.isNaN(mm) || Number.isNaN(dd)) return null;
  const fullYear = yy >= 30 ? 1900 + yy : 2000 + yy;
  return new Date(Date.UTC(fullYear, mm - 1, dd));
}

/** Mask the document number for display — keeps first 2 + last 1 chars. */
export function maskDocumentNumber(raw: string): string {
  if (raw.length <= 3) return raw;
  return raw.slice(0, 2) + '*'.repeat(raw.length - 3) + raw.slice(-1);
}

export interface PassportPipelineState {
  readonly step: PassportPipelineStep;
  readonly draft: PassportMRZDraft;
  readonly chip: PassportChipSnapshot | null;
  readonly proof: PassportProofResult | null;
  readonly isLoading: boolean;
  readonly nfcProgressMessage: string;
  /** 0..100, mirrors the native NfcReadProgress.percent we receive. */
  readonly nfcProgressPercent: number;
  /** Coarse phase from the native callback — drives bar colour / icon. */
  readonly nfcProgressPhase:
    | 'idle'
    | 'connecting'
    | 'authenticating'
    | 'reading-dg'
    | 'verifying'
    | 'done'
    | 'error';
  readonly proofProgressMessage: string;
  /**
   * Explicit overlay stage for proof generation — real milestones only
   * (CLAUDE.md rule 8): 'init' when the prover is starting, 'proving' on
   * the first real generate event, 'done' on actual completion, null when
   * no overlay should show.
   */
  readonly proofOverlayStage: 'init' | 'proving' | 'done' | null;
  readonly errorMessage: string | null;
}

export const initialPassportPipelineState: PassportPipelineState = {
  step: 'mrz',
  draft: {
    passportNumber: '',
    nationalityCode: 'TWN',
    dateOfBirth: '',
    expiryDate: '',
  },
  chip: null,
  proof: null,
  isLoading: false,
  nfcProgressMessage: 'Connecting to chip...',
  nfcProgressPercent: 0,
  nfcProgressPhase: 'idle',
  proofProgressMessage: '',
  proofOverlayStage: null,
  errorMessage: null,
};

export type PassportPipelineAction =
  | { readonly type: 'setDraft'; readonly draft: PassportMRZDraft }
  | { readonly type: 'patchDraft'; readonly patch: Partial<PassportMRZDraft> }
  | { readonly type: 'gotoStep'; readonly step: PassportPipelineStep }
  | { readonly type: 'setLoading'; readonly value: boolean }
  | { readonly type: 'setNfcProgress'; readonly message: string }
  | {
      readonly type: 'setNfcProgressEvent';
      readonly phase: PassportPipelineState['nfcProgressPhase'];
      readonly percent: number;
      readonly message: string;
    }
  | { readonly type: 'setProofProgress'; readonly message: string }
  | {
      readonly type: 'setProofOverlayStage';
      readonly stage: PassportPipelineState['proofOverlayStage'];
    }
  | { readonly type: 'setChip'; readonly chip: PassportChipSnapshot }
  | { readonly type: 'setProof'; readonly proof: PassportProofResult }
  | { readonly type: 'setError'; readonly message: string | null };

export function passportPipelineReducer(
  state: PassportPipelineState,
  action: PassportPipelineAction
): PassportPipelineState {
  switch (action.type) {
    case 'setDraft':
      return { ...state, draft: action.draft };
    case 'patchDraft':
      return { ...state, draft: { ...state.draft, ...action.patch } };
    case 'gotoStep':
      return { ...state, step: action.step };
    case 'setLoading':
      return { ...state, isLoading: action.value };
    case 'setNfcProgress':
      return { ...state, nfcProgressMessage: action.message };
    case 'setNfcProgressEvent':
      // `percent` is clamped to monotonic non-decreasing for the UI so an
      // out-of-order callback (rare but possible across native → JS hops)
      // can't make the bar jump backwards. Only the `done` and `error`
      // phases are allowed to reset.
      return {
        ...state,
        nfcProgressPhase: action.phase,
        nfcProgressPercent:
          action.phase === 'done' || action.phase === 'error'
            ? action.percent
            : Math.max(state.nfcProgressPercent, action.percent),
        nfcProgressMessage: action.message,
      };
    case 'setProofProgress':
      return { ...state, proofProgressMessage: action.message };
    case 'setProofOverlayStage':
      return { ...state, proofOverlayStage: action.stage };
    case 'setChip':
      return { ...state, chip: action.chip, step: 'proof' };
    case 'setProof':
      return { ...state, proof: action.proof, step: 'persist' };
    case 'setError':
      return { ...state, errorMessage: action.message };
  }
}

/**
 * Step → screen ID + title + subtitle (mirrors Swift
 * `currentScreenID/currentTitle/currentSubtitle` on the view model).
 */
export const PASSPORT_STEP_META: Readonly<
  Record<PassportPipelineStep, { readonly id: string; readonly title: string; readonly subtitle: string }>
> = {
  mrz: {
    id: 'PASS-1',
    title: 'passportSetup.step.details.title',
    subtitle: 'passportSetup.step.details.subtitle',
  },
  nfc: {
    id: 'PASS-2',
    title: 'passportSetup.step.read.title',
    subtitle: 'passportSetup.step.read.subtitle',
  },
  proof: {
    id: 'PASS-3',
    title: 'passportSetup.step.check.title',
    subtitle: 'passportSetup.step.check.subtitle',
  },
  persist: {
    id: 'PASS-4',
    title: 'passportSetup.step.save.title',
    subtitle: 'passportSetup.step.save.subtitle',
  },
};

// ---------------------------------------------------------------------------
// Legacy one-shot pipeline (kept for tests / scripts that drove the simple
// runPassportPipeline + onStep callback API).
// ---------------------------------------------------------------------------

export type PassportStep =
  | { readonly type: 'mrzScanned'; readonly mrz: PassportMRZ }
  | { readonly type: 'nfcReading' }
  | { readonly type: 'nfcRead'; readonly result: PassportReadResult }
  | { readonly type: 'proofGenerating' }
  | { readonly type: 'proofGenerated'; readonly proof: ArrayBuffer }
  | { readonly type: 'vcIssued'; readonly jwt: string }
  | { readonly type: 'error'; readonly message: string };

export interface PassportPipelineDeps {
  readonly readChip: (mrz: PassportMRZ) => Promise<PassportReadResult>;
  readonly generateProof: (chipData: PassportReadResult) => Promise<ArrayBuffer>;
  readonly issueVc: (chipData: PassportReadResult, proof: ArrayBuffer) => Promise<string>;
}

export async function runPassportPipeline(
  mrz: PassportMRZ,
  deps: PassportPipelineDeps,
  onStep: (step: PassportStep) => void
): Promise<string> {
  onStep({ type: 'mrzScanned', mrz });
  onStep({ type: 'nfcReading' });
  const chip = await deps.readChip(mrz);
  onStep({ type: 'nfcRead', result: chip });
  onStep({ type: 'proofGenerating' });
  const proof = await deps.generateProof(chip);
  onStep({ type: 'proofGenerated', proof });
  const vcJwt = await deps.issueVc(chip, proof);
  onStep({ type: 'vcIssued', jwt: vcJwt });
  return vcJwt;
}

/** Translate a Nitro PassportReadResult into the UI snapshot model. */
export function chipFromNitro(
  result: PassportReadResult,
  fallbackNationality: string,
  fallbackDocNumber: string
): PassportChipSnapshot {
  // Derive the dataGroupsRead label list from which DGs actually came back
  // with bytes — empty slots are downstream consumers' cue that the chip
  // skipped that DG (e.g. older e-passports without DG14/DG15).
  const dg = result.dataGroups;
  const dataGroupsRead: string[] = ['COM', 'SOD'];
  if (hasDataGroupBytes(dg.dg1)) dataGroupsRead.push('DG1');
  if (hasDataGroupBytes(dg.dg2)) dataGroupsRead.push('DG2');
  if (hasDataGroupBytes(dg.dg14)) dataGroupsRead.push('DG14');
  if (hasDataGroupBytes(dg.dg15)) dataGroupsRead.push('DG15');

  // Best-effort DG1 → MRZ string. The DG1 TLV body holds the printable MRZ
  // characters in ASCII; we strip the TLV header by finding the first
  // ASCII run that looks like an MRZ payload. This mirrors the Swift
  // `realNFCRead` parser which reads `passport.passportMRZ` directly from
  // NFCPassportReader — we re-derive it here from raw bytes so the same
  // logic works once Android jmrtd lands without extending the Nitro spec.
  const dg1MRZData = dg.dg1 ? decodeDg1Mrz(dg.dg1) : '';

  return {
    documentHash: '',
    mrzDigest: '',
    mrz: result.mrz,
    dg1MRZData,
    dataGroups: result.dataGroups,
    chipUid: result.chipUid ?? '',
    bacVerified: true,
    paceVerified: true,
    passiveAuthValid: result.passiveAuthValid,
    passiveAuthPassed: result.passiveAuthValid,
    isSimulated: false,
    readAt: new Date(),
    nationalityCode: result.mrz.nationality || fallbackNationality,
    maskedDocNumber: maskDocumentNumber(result.mrz.documentNumber || fallbackDocNumber),
    dataGroupsRead,
    openAcV3WitnessBundleJson: result.openAcV3WitnessBundleJson,
    activeAuthJson: result.activeAuthJson,
  };
}

function hasDataGroupBytes(value: ArrayBuffer | undefined): boolean {
  return value !== undefined && value.byteLength > 0;
}

/**
 * Extract the printable MRZ string from a DG1 TLV blob. DG1 is a single
 * tag-61 ASN.1 TLV wrapping a tag-5F1F MRZ string (88 bytes for TD3
 * passports). We sweep for the longest contiguous run of MRZ-legal chars
 * (A-Z, 0-9, `<`) which is the MRZ — this is robust to small differences
 * in how iOS NFCPassportReader vs Android jmrtd encode the TLV header.
 */
/**
 * TD3 (passport) MRZ is always exactly 2 × 44 = 88 chars. Other ICAO
 * doc types are smaller (TD1 = 90, TD2 = 72), but for passports the
 * 88-char anchor is reliable.
 */
const TD3_MRZ_LEN = 88;

function decodeDg1Mrz(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let best = '';
  let current = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    const isDigit = byte >= 0x30 && byte <= 0x39;
    const isUpper = byte >= 0x41 && byte <= 0x5a;
    const isFiller = byte === 0x3c; // '<'
    if (isDigit || isUpper || isFiller) {
      current += String.fromCharCode(byte);
    } else {
      if (current.length > best.length) best = current;
      current = '';
    }
  }
  if (current.length > best.length) best = current;

  // DG1 TLV layout: outer `61 <len>` then inner `5F 1F <len> <MRZ>`.
  // The length byte just before the 88 MRZ chars is `0x58` (which
  // demangles to ASCII 'X') for TD3 passports — our greedy filter
  // happily includes that 'X' into the longest run, producing an
  // 89-char string that shifts the nationality + DOB byte positions
  // by 1 and makes the legacy disclosure circuit's age computation underflow
  // ("Failed assertion" inside the prover with no field hint).
  //
  // The MRZ always sits at the end of DG1 (no trailing TLVs after
  // `5F 1F`), so taking the last 88 chars of the run is a reliable
  // trim. Anything shorter passes through unchanged for the caller's
  // own length checks downstream.
  if (best.length > TD3_MRZ_LEN) {
    best = best.slice(best.length - TD3_MRZ_LEN);
  }
  return best;
}

/** Stand-in chip snapshot when the Nitro NFC module isn't linked (Sim/Android). */
export function simulatedChipSnapshot(draft: PassportMRZDraft): PassportChipSnapshot {
  const fakeDigest = '0123456789abcdef0123456789abcdef';
  return {
    documentHash: fakeDigest,
    mrzDigest: fakeDigest,
    mrz: {
      nationality: draft.nationalityCode,
      documentNumber: draft.passportNumber,
      name: '',
      dateOfBirth: draft.dateOfBirth,
      dateOfExpiry: draft.expiryDate,
      gender: '',
    },
    dg1MRZData: `P<${draft.nationalityCode}<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<`,
    dataGroups: {},
    chipUid: `SIM-${fakeDigest.slice(0, 8).toUpperCase()}`,
    bacVerified: true,
    paceVerified: false,
    passiveAuthValid: false,
    passiveAuthPassed: false,
    isSimulated: true,
    readAt: new Date(),
    nationalityCode: draft.nationalityCode,
    maskedDocNumber: maskDocumentNumber(draft.passportNumber),
    dataGroupsRead: ['DG1 (sim)'],
  };
}

// ---------------------------------------------------------------------------
// NFC read strategy selector.
//
// Mirrors Swift `PassportPipelineService.shouldSimulateNFC` and the
// `realNFCRead` / `simulatedNFCRead` split. The screen calls this helper
// instead of inlining the branch so we can unit-test that:
//   - Production (developer mode OFF) never silently falls back to the
//     simulated chip — if the Nitro reader is missing or `isAvailable()`
//     returns false, we surface `unavailable` with a typed reason and the
//     UI shows an error instead of a fake green badge.
//   - Developer mode + simulateNfc toggle keeps the synthetic chip flow
//     for simulator testing (CLAUDE.md Rule 8 carve-out).
// ---------------------------------------------------------------------------

export type NfcReadStrategy =
  | { readonly kind: 'real' }
  | { readonly kind: 'simulated'; readonly reason: 'developer-mode' }
  | {
      readonly kind: 'unavailable';
      readonly reason:
        | 'module-missing'
        | 'hardware-unavailable';
      readonly message: string;
    };

export interface SelectNfcReadStrategyInput {
  /** True when the Nitro HybridObject was successfully created. */
  readonly nitroLinked: boolean;
  /** Result of `getNfcPassport().isAvailable()` — only consulted when linked. */
  readonly hardwareAvailable: boolean;
  /** `usePreferences((s) => s.developerMode)`. */
  readonly developerMode: boolean;
  /** `usePreferences((s) => s.simulateNfc)` — the developer-mode toggle. */
  readonly simulateNfc: boolean;
}

/**
 * Decide whether the NFC chip read should use the real Nitro bridge, the
 * developer-mode simulator path, or short-circuit with an `unavailable`
 * error. There is no silent simulator fallback — if `developerMode` is off
 * and the bridge isn't usable, callers must surface the error to the user.
 */
export function selectNfcReadStrategy(
  input: SelectNfcReadStrategyInput
): NfcReadStrategy {
  const devSimulating = input.developerMode && input.simulateNfc;
  if (!input.nitroLinked) {
    if (devSimulating) return { kind: 'simulated', reason: 'developer-mode' };
    return {
      kind: 'unavailable',
      reason: 'module-missing',
      message:
        'NFC passport reader is not available on this build. ' +
        'Rebuild with `bunx expo prebuild --platform ios && pod install` ' +
        'or enable Developer Mode → Simulate NFC to use the offline mock.',
    };
  }
  if (!input.hardwareAvailable) {
    if (devSimulating) return { kind: 'simulated', reason: 'developer-mode' };
    return {
      kind: 'unavailable',
      reason: 'hardware-unavailable',
      message:
        'This device cannot read NFC passports. ' +
        'Use a physical iPhone 7 or newer, or enable Developer Mode → Simulate NFC.',
    };
  }
  if (devSimulating) return { kind: 'simulated', reason: 'developer-mode' };
  return { kind: 'real' };
}

/** Convert raw proof bytes to a base64-encoded payload. */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa !== 'undefined') return btoa(binary);
  // RN fallback: leave as binary string (rare path; mock proof only).
  return binary;
}

// ---------------------------------------------------------------------------
// ICAO 9303 check-digit helpers + Result-returning pipeline wrapper.
//
// Mirrors Swift `MRZScannerService.computeCheckDigit` byte-for-byte so a
// failing checksum surfaces the same `validationError` payload on both
// sides (CardError.validationError on Swift, { type: 'validationError' } on
// TS via @solidarity/shared/cardError).
//
// Why this exists in TS as well: until the Nitro NFC module is linked on
// Android we still need to validate user-entered MRZ strings before
// hitting the chip, otherwise an off-by-one OCR scan wastes a 30-second
// NFC attempt for an error that should have been caught up front.
// ---------------------------------------------------------------------------

const MRZ_WEIGHTS: readonly [number, number, number] = [7, 3, 1];

/**
 * Compute the ICAO 9303 check digit for an MRZ field. Mirrors Swift's
 * `MRZScannerService.computeCheckDigit` — `<` = 0, digits keep value,
 * letters map to (asciiValue - 'A') + 10. Sum * weight(7,3,1 cycle) mod 10.
 */
export function mrzCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i += 1) {
    const ch = field.charAt(i);
    let value = 0;
    if (ch === '<') {
      value = 0;
    } else if (ch >= '0' && ch <= '9') {
      value = ch.charCodeAt(0) - 48;
    } else if (ch >= 'A' && ch <= 'Z') {
      value = ch.charCodeAt(0) - 65 + 10;
    } else if (ch >= 'a' && ch <= 'z') {
      value = ch.charCodeAt(0) - 97 + 10;
    } else {
      value = 0;
    }
    const weight = MRZ_WEIGHTS[i % 3] ?? 1;
    sum += value * weight;
  }
  return sum % 10;
}

/**
 * Validate the embedded check digits on a `PassportMRZ` payload.
 *
 * Expectations (per ICAO 9303 + Swift NFCPassportReaderService.buildMRZKey):
 *   - `documentNumber` is the 9-char passport number padded with `<`
 *     followed by exactly one digit check digit (10 chars total).
 *     If the input is shorter than 10 chars we left-pad with `<` so the
 *     wire format matches what the chip expects.
 *   - `dateOfBirth` / `dateOfExpiry` are 6 chars (YYMMDD). They do NOT
 *     embed a check digit on the wire because the chip computes them
 *     internally — we only validate the document-number digit here.
 *
 * Returns `validationError` (mirrors Swift CardError.validationError)
 * on mismatch. Success carries `void`.
 */
export function validateMrzChecksum(
  mrz: Pick<PassportMRZ, 'documentNumber' | 'dateOfBirth' | 'dateOfExpiry'>
): Result<void, CardError> {
  const docNumber = mrz.documentNumber.trim();
  if (docNumber.length < 2) {
    return err<CardError>({
      type: 'validationError',
      message: 'Passport number is too short for a check digit.',
    });
  }
  // Last char must be a digit (the check digit). If it isn't, the caller
  // never embedded one, which is itself a validation failure for the
  // strict "with check digit included" contract on PassportMRZ.
  const expected = docNumber.charAt(docNumber.length - 1);
  if (expected < '0' || expected > '9') {
    return err<CardError>({
      type: 'validationError',
      message: 'Passport number check digit is missing or non-numeric.',
    });
  }
  const body = docNumber.slice(0, -1);
  // Pad the document body to 9 chars with `<` (ICAO TD3 field width).
  // This matches Swift `NFCPassportReaderService.pad(_:fieldLength:)`.
  const paddedBody = (body + '<<<<<<<<<').slice(0, 9);
  const computed = mrzCheckDigit(paddedBody);
  if (computed !== Number(expected)) {
    return err<CardError>({
      type: 'validationError',
      message: `MRZ check digit mismatch for passport number (expected ${String(computed)}, got ${expected}).`,
    });
  }
  // YYMMDD fields are not validated here — chip-level CA verifies them
  // against DG1. A wrong DOB or expiry will surface as BAC failure later.
  if (mrz.dateOfBirth.length !== 6 || mrz.dateOfExpiry.length !== 6) {
    return err<CardError>({
      type: 'validationError',
      message: 'MRZ dates must be YYMMDD (6 chars).',
    });
  }
  return ok(undefined);
}

/**
 * Run the legacy callback-style pipeline and wrap thrown errors as
 * structured `CardError`s. Mirrors Swift `PassportPipelineService`
 * which returns `CardResult<T>` from every step (validateMRZ →
 * validationError, readNFCChip → configurationError on NFC failure,
 * generateProof → validationError on MRZ-digest mismatch /
 * configurationError otherwise).
 *
 * Tests use this wrapper to assert typed error codes without losing the
 * step-event stream (`onStep` still fires up to the failure point).
 */
export async function runPassportPipelineSafe(
  mrz: PassportMRZ,
  deps: PassportPipelineDeps,
  onStep: (step: PassportStep) => void
): Promise<Result<string, CardError>> {
  // Up-front checksum validation (mirrors Swift PassportPipelineService.validateMRZ).
  const checksum = validateMrzChecksum(mrz);
  if (!checksum.ok) {
    onStep({ type: 'error', message: checksum.error.message });
    return checksum;
  }
  try {
    const jwt = await runPassportPipeline(mrz, deps, onStep);
    return ok(jwt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const type = classifyPassportError(message);
    onStep({ type: 'error', message });
    return err<CardError>({ type, message });
  }
}

/** Map a thrown error message into a typed CardError variant. */
function classifyPassportError(message: string): CardError['type'] {
  const lower = message.toLowerCase();
  if (lower.includes('nfc') || lower.includes('chip') || lower.includes('bac') || lower.includes('pace') || lower.includes('passive')) {
    return 'configurationError';
  }
  if (lower.includes('mrz') || lower.includes('checksum') || lower.includes('digest mismatch')) {
    return 'validationError';
  }
  if (lower.includes('proof') || lower.includes('verify')) {
    return 'proofGenerationError';
  }
  return 'configurationError';
}

// ---------------------------------------------------------------------------
// ZK passport proof — verifier + public-input derivation.
//
// Swift reference: MoproProofService.generateWithOpenPassport →
// publicSignals = ["is_human", "age_over_18"?, "nationality:XXX"]. Verifier
// returns Bool. We expose the same shape on the TS side so tests can
// generate a proof through the Nitro bridge, build the same public inputs,
// then assert verifyNoirProof returns true.
//
// Field ordering MUST match Swift's JSONEncoder(sortedKeys) — alphabetical
// by UTF-8. See packages/parity-fixtures/fixtures/passport/*.json for the
// reference layout.
// ---------------------------------------------------------------------------

/**
 * Public-signal payload exposed by a passport ZK proof. Mirrors Swift
 * `MoproProofOutput.publicSignals` — the disclosed claims that downstream
 * verifiers need to bind to the proof bytes.
 */
export interface PassportPublicSignals {
  /** True when the chip witness attested DOB → current age ≥ 18. */
  readonly ageOver18: boolean;
  /** Disclosed nationality (ISO 3166 alpha-3) or empty if undisclosed. */
  readonly nationality: string;
  /** Hex digest of the DG1 MRZ bytes (lowercase, no `0x` prefix). */
  readonly mrzHashHex: string;
  /** Always true for any passport that produced a valid witness. */
  readonly isHuman: boolean;
}

/**
 * Derive the public signal payload from raw passport chip data.
 * Mirrors Swift `MoproProofService.buildDisclosureWitness` — same input
 * → same signals. No randomness; safe to use as a parity fixture key.
 */
export function derivePassportPublicSignals(args: {
  readonly dg1MRZData: string;
  readonly fallbackNationality: string;
  readonly currentDateYyMmDd: string;
}): PassportPublicSignals {
  const sanitized = sanitizeMRZ(args.dg1MRZData);
  // Without 88 chars of MRZ we can't derive nationality / DOB from DG1.
  // Fall back to the user-entered nationality and assume ageOver18 = false.
  if (sanitized.length < 88) {
    return {
      ageOver18: false,
      nationality: args.fallbackNationality.toUpperCase().slice(0, 3),
      mrzHashHex: '',
      isHuman: true,
    };
  }
  // TD3 line 2 positions 10-12 = nationality, 13-18 = DOB.
  const nationalityRaw = sanitized.slice(54, 57);
  const nationality = nationalityRaw.replace(/</g, '');
  const dob = sanitized.slice(57, 63);
  return {
    ageOver18: isAgeAtLeast18(dob, args.currentDateYyMmDd),
    nationality: nationality || args.fallbackNationality.toUpperCase().slice(0, 3),
    mrzHashHex: '', // computed by the caller via @solidarity/shared sha256Bytes
    isHuman: true,
  };
}

function sanitizeMRZ(raw: string): string {
  const upper = raw.toUpperCase();
  let out = '';
  for (const ch of upper) {
    const code = ch.charCodeAt(0);
    const isAlphaNum =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90);
    if (isAlphaNum || ch === '<') out += ch;
  }
  return out;
}

function isAgeAtLeast18(dobYyMmDd: string, currentYyMmDd: string): boolean {
  if (dobYyMmDd.length !== 6 || currentYyMmDd.length !== 6) return false;
  const birthYear = Number(dobYyMmDd.slice(0, 2));
  const birthMonth = Number(dobYyMmDd.slice(2, 4));
  const birthDay = Number(dobYyMmDd.slice(4, 6));
  const currentYear = Number(currentYyMmDd.slice(0, 2));
  const currentMonth = Number(currentYyMmDd.slice(2, 4));
  const currentDay = Number(currentYyMmDd.slice(4, 6));
  if (
    Number.isNaN(birthYear) ||
    Number.isNaN(birthMonth) ||
    Number.isNaN(birthDay) ||
    Number.isNaN(currentYear) ||
    Number.isNaN(currentMonth) ||
    Number.isNaN(currentDay)
  ) {
    return false;
  }
  let age = currentYear >= birthYear ? currentYear - birthYear : 100 + currentYear - birthYear;
  const birthdayPassed =
    currentMonth > birthMonth ||
    (currentMonth === birthMonth && currentDay >= birthDay);
  if (!birthdayPassed && age > 0) age -= 1;
  return age >= 18;
}

/**
 * Serialize public signals + proof metadata into the JSON shape Swift
 * `buildOpenPassportPayload` emits. Keys are alphabetically sorted —
 * MUST stay in lockstep with Swift JSONEncoder(sortedKeys) for parity.
 */
export function serializePassportProofPayload(args: {
  readonly proofType: string;
  readonly mrzHashHex: string;
  readonly publicSignals: PassportPublicSignals;
  readonly proofB64: string;
  readonly vkB64: string;
}): string {
  const payload = {
    age_over_18: args.publicSignals.ageOver18,
    is_human: args.publicSignals.isHuman,
    mrz_hash: args.mrzHashHex,
    nationality: args.publicSignals.nationality,
    proof_b64: args.proofB64,
    proof_type: args.proofType,
    vk_b64: args.vkB64,
  };
  return JSON.stringify(payload);
}
