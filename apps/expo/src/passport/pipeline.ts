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
