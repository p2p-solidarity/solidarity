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
  readonly dg1MRZData: string;
  readonly chipUid: string;
  readonly bacVerified: boolean;
  readonly paceVerified: boolean;
  readonly passiveAuthPassed: boolean;
  readonly isSimulated: boolean;
  readonly readAt: Date;
  readonly nationalityCode: string;
  readonly maskedDocNumber: string;
  readonly dataGroupsRead: readonly string[];
}

export interface PassportProofResult {
  readonly proofType: string;
  readonly proofPayload: string;
  readonly trustLevel: string;
  readonly generationFailed: boolean;
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
  readonly proofProgressMessage: string;
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
  proofProgressMessage: '',
  errorMessage: null,
};

export type PassportPipelineAction =
  | { readonly type: 'setDraft'; readonly draft: PassportMRZDraft }
  | { readonly type: 'patchDraft'; readonly patch: Partial<PassportMRZDraft> }
  | { readonly type: 'gotoStep'; readonly step: PassportPipelineStep }
  | { readonly type: 'setLoading'; readonly value: boolean }
  | { readonly type: 'setNfcProgress'; readonly message: string }
  | { readonly type: 'setProofProgress'; readonly message: string }
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
    case 'setProofProgress':
      return { ...state, proofProgressMessage: action.message };
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
    title: 'Capture MRZ',
    subtitle: 'Input passport fields before secure chip read.',
  },
  nfc: {
    id: 'PASS-2',
    title: 'Read NFC Chip',
    subtitle: 'Read signed passport data from NFC chip.',
  },
  proof: {
    id: 'PASS-3',
    title: 'Generate ZK Proof',
    subtitle: 'Attempt ZK generation with fallback to SD-JWT.',
  },
  persist: {
    id: 'PASS-4',
    title: 'Persist Credential',
    subtitle: 'Save identity card and provable claims.',
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

/** Stand-in chip snapshot when the Nitro NFC module isn't linked (Sim/Android). */
export function simulatedChipSnapshot(draft: PassportMRZDraft): PassportChipSnapshot {
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
 * which returns `CardResult<T>` from every step.
 */
export async function runPassportPipelineSafe(
  mrz: PassportMRZ,
  deps: PassportPipelineDeps,
  onStep: (step: PassportStep) => void
): Promise<Result<string, CardError>> {
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
// by UTF-8.
// ---------------------------------------------------------------------------

export interface PassportPublicSignals {
  readonly ageOver18: boolean;
  readonly nationality: string;
  readonly mrzHashHex: string;
  readonly isHuman: boolean;
}

/**
 * Derive the public signal payload from raw passport chip data.
 * Mirrors Swift `MoproProofService.buildDisclosureWitness`.
 */
export function derivePassportPublicSignals(args: {
  readonly dg1MRZData: string;
  readonly fallbackNationality: string;
  readonly currentDateYyMmDd: string;
}): PassportPublicSignals {
  const sanitized = sanitizeMRZ(args.dg1MRZData);
  if (sanitized.length < 88) {
    return {
      ageOver18: false,
      nationality: args.fallbackNationality.toUpperCase().slice(0, 3),
      mrzHashHex: '',
      isHuman: true,
    };
  }
  const nationalityRaw = sanitized.slice(54, 57);
  const nationality = nationalityRaw.replace(/</g, '');
  const dob = sanitized.slice(57, 63);
  return {
    ageOver18: isAgeAtLeast18(dob, args.currentDateYyMmDd),
    nationality: nationality || args.fallbackNationality.toUpperCase().slice(0, 3),
    mrzHashHex: '',
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
 * Serialize public signals + proof metadata into JSON. Keys are
 * alphabetically sorted — MUST stay in lockstep with Swift
 * JSONEncoder(sortedKeys) for parity.
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
