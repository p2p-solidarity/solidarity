import type { PassportReadResult } from '@solidarity/nitro-nfc-passport';

import {
  parsePassportOpenAcV3ActiveAuthJson,
  parsePassportOpenAcV3WitnessBundleJson,
} from '@/passport/openacV3';
import type { PassportChipSnapshot } from '@/passport/pipeline';

export type PassportProofErrorCode =
  | 'PASSPORT_AA_MISSING_INPUTS'
  | 'PASSPORT_AA_INVALID_PUBLIC_KEY'
  | 'PASSPORT_ZK_UNAVAILABLE'
  | 'PASSPORT_PROOF_FAILED';

export type PassportErrorPhase =
  | 'nfc-read'
  | 'proof-generation'
  | 'persist';

export const ZK_UNAVAILABLE_RE =
  /passport-zk Android impl not linked|build libpassport_zk_mopro\.so first|UnsatisfiedLinkError|Native ZK library failed to load|cannot locate symbol/i;

/** @deprecated alias retained for grep; use `ZK_UNAVAILABLE_RE`. */
export const ZK_NOT_LINKED_RE = ZK_UNAVAILABLE_RE;

const AA_INVALID_PUBLIC_KEY_RE =
  /ecdsa_(?:secp256k1|secp256r1)|Invalid public key provided for ECDSA verification/i;
const AA_MISSING_INPUTS_RE =
  /OpenAC v3 missing (?:DG15|Active Authentication evidence)|OpenAC v3 witness request missing DG15|OpenAC v3 witness unavailable: (?:missing-dg15|missing-active-auth-witness)/i;

type PassportDiagnosticsChip =
  | Partial<
      Pick<
        PassportChipSnapshot,
        | 'activeAuthJson'
        | 'dataGroups'
        | 'dataGroupsRead'
        | 'isSimulated'
        | 'openAcV3WitnessBundleJson'
        | 'passiveAuthPassed'
      >
    >
  | Partial<
      Pick<
        PassportReadResult,
        | 'activeAuthJson'
        | 'dataGroups'
        | 'openAcV3WitnessBundleJson'
        | 'passiveAuthValid'
      >
    >;

export interface BuildPassportErrorDetailInput {
  readonly phase: PassportErrorPhase;
  readonly error: unknown;
  readonly chip?: PassportDiagnosticsChip | null;
}

export function classifyPassportProofError(error: unknown): PassportProofErrorCode {
  const raw = errorMessage(error);
  if (ZK_UNAVAILABLE_RE.test(raw)) return 'PASSPORT_ZK_UNAVAILABLE';
  if (AA_MISSING_INPUTS_RE.test(raw)) return 'PASSPORT_AA_MISSING_INPUTS';
  if (AA_INVALID_PUBLIC_KEY_RE.test(raw)) {
    return 'PASSPORT_AA_INVALID_PUBLIC_KEY';
  }
  return 'PASSPORT_PROOF_FAILED';
}

export function friendlyProofError(err: unknown): string {
  const raw = errorMessage(err);
  const code = classifyPassportProofError(raw);
  if (code === 'PASSPORT_ZK_UNAVAILABLE') {
    return 'ZK prover not yet built for this device.';
  }
  if (code === 'PASSPORT_AA_MISSING_INPUTS') {
    return 'Passport chip did not provide DG15 Active Authentication data.';
  }
  if (code === 'PASSPORT_AA_INVALID_PUBLIC_KEY') {
    return 'Passport proof failed while checking Active Authentication.';
  }
  return firstLine(raw) || 'Proof generation failed';
}

export function buildPassportErrorDetail(
  input: BuildPassportErrorDetailInput
): string {
  const chip = input.chip ?? null;
  const lines = [
    `Phase: ${input.phase}`,
    `Error code: ${classifyPhaseError(input.phase, input.error)}`,
    '',
    'Passport NFC diagnostics:',
    `Data groups read: ${formatDataGroupsRead(chip)}`,
    `SOD: ${formatDataGroup(chip?.dataGroups?.sod)}`,
    `DG1: ${formatDataGroup(chip?.dataGroups?.dg1)}`,
    `DG2: ${formatDataGroup(chip?.dataGroups?.dg2)}`,
    `DG14: ${formatDataGroup(chip?.dataGroups?.dg14)}`,
    `DG15: ${formatDataGroup(chip?.dataGroups?.dg15)}`,
    `Passive authentication: ${formatPassiveAuth(chip)}`,
    `Active Authentication evidence: ${formatActiveAuth(chip?.activeAuthJson)}`,
    `OpenAC v3 witness: ${formatWitness(chip?.openAcV3WitnessBundleJson)}`,
    `Simulated chip: ${formatBoolean(readBoolean(chip, 'isSimulated'))}`,
    '',
    `Likely cause: ${likelyCause(input.phase, input.error, chip)}`,
    '',
    'Raw error:',
    errorDetail(input.error) || '(none)',
  ];
  return lines.join('\n');
}

function classifyPhaseError(phase: PassportErrorPhase, error: unknown): string {
  if (phase === 'proof-generation') return classifyPassportProofError(error);
  if (phase === 'nfc-read') return 'PASSPORT_NFC_READ_FAILED';
  return 'PASSPORT_SAVE_FAILED';
}

function likelyCause(
  phase: PassportErrorPhase,
  error: unknown,
  chip: PassportDiagnosticsChip | null
): string {
  if (phase === 'nfc-read') {
    return 'The passport NFC session failed before a complete chip snapshot was available.';
  }
  if (phase === 'persist') {
    return 'The passport credential was read/proved, but saving it to local identity storage failed.';
  }

  const code = classifyPassportProofError(error);
  if (code === 'PASSPORT_ZK_UNAVAILABLE') {
    return 'The native passport-noir prover is not linked or could not be loaded on this build.';
  }
  if (
    code !== 'PASSPORT_AA_INVALID_PUBLIC_KEY' &&
    code !== 'PASSPORT_AA_MISSING_INPUTS'
  ) {
    return 'The prover failed with an unclassified passport proof error.';
  }

  const hasDg15 = hasBytes(chip?.dataGroups?.dg15);
  const hasAa = parsePassportOpenAcV3ActiveAuthJson(chip?.activeAuthJson) !== null;
  if (!hasDg15) return 'DG15 was not returned by the NFC reader.';
  if (!hasAa) {
    return 'DG15 was returned, but native Active Authentication evidence is missing or invalid.';
  }
  return 'DG15 and AA were present; inspect passport-noir witness/circuit inputs.';
}

function formatDataGroupsRead(chip: PassportDiagnosticsChip | null): string {
  const labels = readDataGroupsRead(chip);
  if (labels.length > 0) return labels.join(', ');

  const inferred = [
    hasBytes(chip?.dataGroups?.sod) ? 'SOD' : null,
    hasBytes(chip?.dataGroups?.dg1) ? 'DG1' : null,
    hasBytes(chip?.dataGroups?.dg2) ? 'DG2' : null,
    hasBytes(chip?.dataGroups?.dg14) ? 'DG14' : null,
    hasBytes(chip?.dataGroups?.dg15) ? 'DG15' : null,
  ].filter((label): label is string => label !== null);
  return inferred.length > 0 ? inferred.join(', ') : 'unknown';
}

function readDataGroupsRead(chip: PassportDiagnosticsChip | null): readonly string[] {
  if (chip == null || !('dataGroupsRead' in chip)) return [];
  const raw = chip.dataGroupsRead;
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : [];
}

function formatDataGroup(value: ArrayBuffer | undefined): string {
  if (!hasBytes(value)) return 'missing';
  return `present (${value.byteLength} bytes)`;
}

function hasBytes(value: ArrayBuffer | undefined): value is ArrayBuffer {
  return value !== undefined && value.byteLength > 0;
}

function formatPassiveAuth(chip: PassportDiagnosticsChip | null): string {
  const snapshotValue = readBoolean(chip, 'passiveAuthPassed');
  if (snapshotValue !== undefined) return snapshotValue ? 'passed' : 'failed';
  const readResultValue = readBoolean(chip, 'passiveAuthValid');
  if (readResultValue !== undefined) return readResultValue ? 'passed' : 'failed';
  return 'unknown';
}

function formatActiveAuth(value: string | undefined): string {
  if (value == null || value.length === 0) return 'missing';
  return parsePassportOpenAcV3ActiveAuthJson(value) === null ? 'invalid' : 'present';
}

function formatWitness(value: string | undefined): string {
  if (value == null || value.length === 0) return 'missing';
  return parsePassportOpenAcV3WitnessBundleJson(value) === null ? 'invalid' : 'present';
}

function readBoolean(
  value: PassportDiagnosticsChip | null,
  key: 'isSimulated' | 'passiveAuthPassed' | 'passiveAuthValid'
): boolean | undefined {
  if (value == null || !(key in value)) return undefined;
  const raw = value[key as keyof PassportDiagnosticsChip];
  return typeof raw === 'boolean' ? raw : undefined;
}

function formatBoolean(value: boolean | undefined): string {
  if (value === undefined) return 'unknown';
  return value ? 'yes' : 'no';
}

function firstLine(value: string): string {
  return value.split('\n')[0] ?? '';
}

function errorMessage(error: unknown): string {
  if (error == null) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (typeof error === 'number' || typeof error === 'boolean') return String(error);
  if (typeof error === 'bigint') return error.toString();
  if (typeof error === 'symbol') return error.description ?? 'symbol';
  try {
    const json = JSON.stringify(error);
    return typeof json === 'string' ? json : '[unserialisable error value]';
  } catch {
    return '[unserialisable error value]';
  }
}

function errorDetail(error: unknown): string {
  if (error == null) return '';
  if (error instanceof Error) {
    const stack = error.stack ? `\n${error.stack}` : '';
    return `${error.name}: ${error.message}${stack}`;
  }
  return errorMessage(error);
}
