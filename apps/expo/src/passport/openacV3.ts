import type { PassportReadResult } from '@solidarity/nitro-nfc-passport';
import { base64Encode } from '@solidarity/shared';

export const PASSPORT_NOIR_VERSION = '0.3.0' as const;
export const PASSPORT_V3_PROOF_TYPE = 'passport_v3' as const;
export const PASSPORT_REVOCATION_SNAPSHOT_SCHEMA =
  'gg.solidarity.passport.revocation.v1' as const;
export const PASSPORT_OPENAC_V3_WITNESS_REQUEST_SCHEMA =
  'gg.solidarity.passport.openac-v3.witness-request.v1' as const;

export type PassportOpenAcV3CircuitName =
  | 'dsc_chain'
  | 'passport_adapter'
  | 'openac_show';

export interface PassportOpenAcV3Circuit {
  readonly name: PassportOpenAcV3CircuitName;
  /**
   * Alias passed to the Nitro native resolver. 0.3.0 release artifacts are
   * bundled as `<name>.json` and `<name>.srs.bin`; native resolves aliases to
   * real filesystem paths before calling mopro.
   */
  readonly circuitPath: PassportOpenAcV3CircuitName;
  readonly srsPath: PassportOpenAcV3CircuitName;
  readonly circuitAsset: `${PassportOpenAcV3CircuitName}.json`;
  readonly srsAsset: `${PassportOpenAcV3CircuitName}.srs.bin`;
}

export const PASSPORT_OPENAC_V3_CIRCUITS: readonly PassportOpenAcV3Circuit[] = [
  {
    name: 'dsc_chain',
    circuitPath: 'dsc_chain',
    srsPath: 'dsc_chain',
    circuitAsset: 'dsc_chain.json',
    srsAsset: 'dsc_chain.srs.bin',
  },
  {
    name: 'passport_adapter',
    circuitPath: 'passport_adapter',
    srsPath: 'passport_adapter',
    circuitAsset: 'passport_adapter.json',
    srsAsset: 'passport_adapter.srs.bin',
  },
  {
    name: 'openac_show',
    circuitPath: 'openac_show',
    srsPath: 'openac_show',
    circuitAsset: 'openac_show.json',
    srsAsset: 'openac_show.srs.bin',
  },
] as const;

export const PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS = [
  'SOD',
  'DG1',
  'DG15',
] as const;

export type PassportOpenAcV3DataGroup =
  (typeof PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS)[number];

export type PassportOpenAcV3NotReadyReason =
  | 'simulated-chip'
  | 'passive-auth-failed'
  | 'missing-data-groups'
  | 'missing-revocation-snapshot'
  | 'invalid-revocation-snapshot';

export interface PassportRevocationSnapshotSource {
  readonly id: string;
  readonly uri: string;
  readonly format: string;
  readonly sha256: string;
  readonly crlCount: number;
  readonly revokedCertificateCount: number;
}

export interface PassportRevocationSnapshotEntry {
  readonly sourceId: string;
  readonly crlIndex: number;
  readonly issuerName: string;
  readonly issuerNameSha256: string;
  readonly authorityKeyIdentifierHex: string | null;
  readonly serialHex: string;
  readonly serial20Hex: string;
  readonly revokedAt: string | null;
}

export interface PassportRevocationSnapshot {
  readonly schema: typeof PASSPORT_REVOCATION_SNAPSHOT_SCHEMA;
  readonly generatedAt: string;
  readonly sourceCount: number;
  readonly revokedCertificateCount: number;
  readonly sourceSetSha256: string;
  readonly sources: readonly PassportRevocationSnapshotSource[];
  readonly entries: readonly PassportRevocationSnapshotEntry[];
}

export type PassportOpenAcV3Readiness =
  | {
      readonly ready: true;
      readonly version: typeof PASSPORT_NOIR_VERSION;
      readonly proofType: typeof PASSPORT_V3_PROOF_TYPE;
      readonly requiredDataGroups: typeof PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS;
      readonly revocationSnapshot: PassportRevocationSnapshot;
    }
  | {
      readonly ready: false;
      readonly version: typeof PASSPORT_NOIR_VERSION;
      readonly proofType: typeof PASSPORT_V3_PROOF_TYPE;
      readonly reason: PassportOpenAcV3NotReadyReason;
      readonly missingDataGroups: readonly PassportOpenAcV3DataGroup[];
    };

export interface PassportOpenAcV3ReadinessSource {
  readonly dataGroups?: PassportReadResult['dataGroups'];
  readonly passiveAuthValid?: boolean;
  readonly passiveAuthPassed?: boolean;
  readonly isSimulated?: boolean;
  readonly revocationSnapshot?: unknown;
}

export type PassportOpenAcV3ProofPlan =
  | {
      readonly kind: 'openac-v3';
      readonly version: typeof PASSPORT_NOIR_VERSION;
      readonly proofType: typeof PASSPORT_V3_PROOF_TYPE;
      readonly circuits: typeof PASSPORT_OPENAC_V3_CIRCUITS;
      readonly requiredDataGroups: typeof PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS;
      readonly revocationSnapshot: PassportRevocationSnapshot;
    }
  | {
      readonly kind: 'fallback';
      readonly version: typeof PASSPORT_NOIR_VERSION;
      readonly proofType: 'sd-jwt-fallback';
      readonly readiness: Extract<PassportOpenAcV3Readiness, { ready: false }>;
    };

export interface PassportOpenAcV3WitnessBundle {
  readonly dscChainInputsJson: string;
  readonly passportAdapterInputsJson: string;
  readonly openAcShowInputsJson: string;
}

export interface PassportOpenAcV3ActiveAuthEvidence {
  /** base64 of the 32-byte SHA-256 digest the chip's AA key signed. */
  readonly challengeB64: string;
  /** base64 of the raw 64-byte r||s ECDSA-P256 signature. */
  readonly signatureRawB64: string;
}

export interface BuildPassportOpenAcV3WitnessRequestJsonArgs {
  readonly chip: Pick<PassportReadResult, 'dataGroups' | 'mrz' | 'passiveAuthValid'>;
  readonly revocationSnapshot: PassportRevocationSnapshot;
  readonly devicePublicKeyRaw: Uint8Array;
  readonly nonceHash: Uint8Array;
  readonly linkScope: string;
  readonly requireAA: boolean;
  /**
   * DG15 Active Authentication evidence from the native read
   * (`PassportReadResult.activeAuthJson`, already parsed). Required when
   * `requireAA` is true — the Rust builder fails closed with
   * `missing-active-auth-witness` otherwise.
   */
  readonly activeAuth?: PassportOpenAcV3ActiveAuthEvidence;
}

export interface PassportOpenAcV3WitnessBuildResult {
  readonly schema: string;
  readonly passportNoirVersion: string;
  readonly ready: boolean;
  readonly reason?: string;
  readonly bundleJson?: string;
}

export interface PassportOpenAcV3WitnessBuilder {
  buildOpenAcV3WitnessBundle(
    requestJson: string
  ): Promise<PassportOpenAcV3WitnessBuildResult>;
}

export interface BuildPassportOpenAcV3WitnessBundleJsonArgs
  extends BuildPassportOpenAcV3WitnessRequestJsonArgs {
  readonly builder: PassportOpenAcV3WitnessBuilder;
}

export type PassportOpenAcV3DeviceBindingNotReadyReason =
  | 'missing-nonce-hash'
  | 'missing-device-public-key'
  | 'device-public-key-mismatch'
  | 'invalid-device-signature';

export type PassportOpenAcV3DeviceBindingResult =
  | {
      readonly ready: true;
      readonly witnesses: PassportOpenAcV3WitnessBundle;
    }
  | {
      readonly ready: false;
      readonly reason: PassportOpenAcV3DeviceBindingNotReadyReason;
    };

export type PassportOpenAcV3DeviceSigner = (
  nonceHash: Uint8Array
) => Promise<{
  readonly signature: Uint8Array;
  readonly publicKeyRaw: Uint8Array;
}>;

export type PassportOpenAcV3ProofStage = 'prepare' | 'show';

export interface PassportOpenAcV3NoirProof {
  readonly proof: ArrayBuffer;
  readonly vk: ArrayBuffer;
}

export interface PassportOpenAcV3Prover {
  generateNoirProof(
    circuitPath: string,
    srsPath: string | undefined,
    inputsJson: string
  ): Promise<PassportOpenAcV3NoirProof>;
  verifyNoirProof(proof: ArrayBuffer, vk: ArrayBuffer): Promise<boolean>;
}

export interface PassportOpenAcV3EncodedProof {
  readonly circuit: PassportOpenAcV3CircuitName;
  readonly stage: PassportOpenAcV3ProofStage;
  readonly circuitAsset: string;
  readonly srsAsset: string;
  readonly proofB64: string;
  readonly vkB64: string;
}

export interface PassportOpenAcV3ProofRunnerProgress {
  readonly phase: 'generate' | 'verify';
  readonly circuit: PassportOpenAcV3Circuit;
}

export interface GeneratePassportOpenAcV3ProofPayloadArgs {
  readonly plan: Extract<PassportOpenAcV3ProofPlan, { kind: 'openac-v3' }>;
  readonly witnesses: PassportOpenAcV3WitnessBundle;
  readonly prover: PassportOpenAcV3Prover;
  readonly encodeProofBytes: (buffer: ArrayBuffer) => string;
  readonly onProgress?: (event: PassportOpenAcV3ProofRunnerProgress) => void;
}

export interface GeneratePassportOpenAcV3ProofPayloadResult {
  readonly proofPayload: string;
  readonly proofs: readonly PassportOpenAcV3EncodedProof[];
}

export interface PassportOpenAcV3ProofCall {
  readonly circuit: PassportOpenAcV3Circuit;
  readonly inputsJson: string;
}

export function assessPassportOpenAcV3Readiness(
  source: PassportOpenAcV3ReadinessSource
): PassportOpenAcV3Readiness {
  if (source.isSimulated) {
    return notReady('simulated-chip', []);
  }

  const passiveAuthPassed =
    source.passiveAuthValid ?? source.passiveAuthPassed ?? false;
  if (!passiveAuthPassed) {
    return notReady('passive-auth-failed', []);
  }

  const missingDataGroups = missingOpenAcDataGroups(source.dataGroups);
  if (missingDataGroups.length > 0) {
    return notReady('missing-data-groups', missingDataGroups);
  }

  if (source.revocationSnapshot == null) {
    return notReady('missing-revocation-snapshot', []);
  }
  if (!isPassportRevocationSnapshot(source.revocationSnapshot)) {
    return notReady('invalid-revocation-snapshot', []);
  }

  return {
    ready: true,
    version: PASSPORT_NOIR_VERSION,
    proofType: PASSPORT_V3_PROOF_TYPE,
    requiredDataGroups: PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS,
    revocationSnapshot: source.revocationSnapshot,
  };
}

export function buildPassportOpenAcV3ProofPlan(
  source: PassportOpenAcV3ReadinessSource
): PassportOpenAcV3ProofPlan {
  const readiness = assessPassportOpenAcV3Readiness(source);
  if (!readiness.ready) {
    return {
      kind: 'fallback',
      version: PASSPORT_NOIR_VERSION,
      proofType: 'sd-jwt-fallback',
      readiness,
    };
  }
  return {
    kind: 'openac-v3',
    version: PASSPORT_NOIR_VERSION,
    proofType: PASSPORT_V3_PROOF_TYPE,
    circuits: PASSPORT_OPENAC_V3_CIRCUITS,
    requiredDataGroups: PASSPORT_OPENAC_V3_REQUIRED_DATA_GROUPS,
    revocationSnapshot: readiness.revocationSnapshot,
  };
}

export function buildPassportOpenAcV3ProofCalls(
  plan: Extract<PassportOpenAcV3ProofPlan, { kind: 'openac-v3' }>,
  witnesses: PassportOpenAcV3WitnessBundle
): readonly PassportOpenAcV3ProofCall[] {
  const witnessByCircuit = {
    dsc_chain: witnesses.dscChainInputsJson,
    passport_adapter: witnesses.passportAdapterInputsJson,
    openac_show: witnesses.openAcShowInputsJson,
  } satisfies Record<PassportOpenAcV3CircuitName, string>;

  return plan.circuits.map((circuit) => ({
    circuit,
    inputsJson: witnessByCircuit[circuit.name],
  }));
}

export function parsePassportOpenAcV3WitnessBundleJson(
  value: string | undefined
): PassportOpenAcV3WitnessBundle | null {
  if (!isNonEmptyString(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isPassportOpenAcV3WitnessBundle(parsed)) return null;
  return parsed;
}

export function isPassportOpenAcV3WitnessBundle(
  value: unknown
): value is PassportOpenAcV3WitnessBundle {
  if (!isRecord(value)) return false;
  return (
    isWitnessInputsJson(value['dscChainInputsJson']) &&
    isWitnessInputsJson(value['passportAdapterInputsJson']) &&
    isWitnessInputsJson(value['openAcShowInputsJson'])
  );
}

export function buildPassportOpenAcV3WitnessRequestJson(
  args: BuildPassportOpenAcV3WitnessRequestJsonArgs
): string {
  if (args.devicePublicKeyRaw.length !== 64) {
    throw new Error(
      `OpenAC v3 witness request requires 64-byte raw P-256 public key (got ${args.devicePublicKeyRaw.length})`
    );
  }
  if (args.nonceHash.length !== 32) {
    throw new Error(
      `OpenAC v3 witness request requires 32-byte nonce_hash (got ${args.nonceHash.length})`
    );
  }
  if (!isNonEmptyString(args.linkScope)) {
    throw new Error('OpenAC v3 witness request requires a non-empty linkScope');
  }
  const dataGroups = {
    sod: encodeRequiredDataGroup(args.chip.dataGroups?.sod, 'SOD'),
    dg1: encodeRequiredDataGroup(args.chip.dataGroups?.dg1, 'DG1'),
    dg15: encodeRequiredDataGroup(args.chip.dataGroups?.dg15, 'DG15'),
  };

  return JSON.stringify({
    schema: PASSPORT_OPENAC_V3_WITNESS_REQUEST_SCHEMA,
    passportNoirVersion: PASSPORT_NOIR_VERSION,
    mrz: args.chip.mrz,
    passiveAuthValid: args.chip.passiveAuthValid,
    dataGroups,
    revocationSnapshot: args.revocationSnapshot,
    devicePublicKeyRawB64: base64Encode(args.devicePublicKeyRaw),
    nonceHashB64: base64Encode(args.nonceHash),
    linkScope: args.linkScope,
    requireAA: args.requireAA,
    ...(args.activeAuth
      ? {
          activeAuth: {
            challengeB64: args.activeAuth.challengeB64,
            signatureRawB64: args.activeAuth.signatureRawB64,
          },
        }
      : {}),
  });
}

/**
 * Parse the native `PassportReadResult.activeAuthJson` string into the
 * structured AA evidence the witness request consumes. Returns null when the
 * field is absent (RSA-AA / AA-less passport) or malformed — the caller fails
 * closed on the `requireAA` path.
 */
export function parsePassportOpenAcV3ActiveAuthJson(
  value: string | undefined
): PassportOpenAcV3ActiveAuthEvidence | null {
  if (!isNonEmptyString(value)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const challengeB64 = parsed['challengeB64'];
  const signatureRawB64 = parsed['signatureRawB64'];
  if (!isNonEmptyString(challengeB64) || !isNonEmptyString(signatureRawB64)) {
    return null;
  }
  return { challengeB64, signatureRawB64 };
}

export async function buildPassportOpenAcV3WitnessBundleJson(
  args: BuildPassportOpenAcV3WitnessBundleJsonArgs
): Promise<string> {
  const requestJson = buildPassportOpenAcV3WitnessRequestJson(args);
  const result = await args.builder.buildOpenAcV3WitnessBundle(requestJson);
  if (
    result.schema !== 'gg.solidarity.passport.openac-v3.witness-build-result.v1'
  ) {
    throw new Error('OpenAC v3 witness builder returned an invalid result schema');
  }
  if (result.passportNoirVersion !== PASSPORT_NOIR_VERSION) {
    throw new Error(
      `OpenAC v3 witness builder returned unsupported passport-noir version ${result.passportNoirVersion}`
    );
  }
  if (!result.ready) {
    throw new Error(
      `OpenAC v3 witness unavailable: ${result.reason ?? 'unknown-reason'}`
    );
  }
  if (!isNonEmptyString(result.bundleJson)) {
    throw new Error('OpenAC v3 witness builder returned ready without bundleJson');
  }
  const witnesses = parsePassportOpenAcV3WitnessBundleJson(result.bundleJson);
  if (witnesses === null) {
    throw new Error('OpenAC v3 witness builder returned malformed bundleJson');
  }
  return result.bundleJson;
}

export async function bindPassportOpenAcV3DeviceSignature(
  witnesses: PassportOpenAcV3WitnessBundle,
  signDeviceDigest: PassportOpenAcV3DeviceSigner
): Promise<PassportOpenAcV3DeviceBindingResult> {
  const passportAdapter = parseWitnessInputsRecord(witnesses.passportAdapterInputsJson);
  const openAcShow = parseWitnessInputsRecord(witnesses.openAcShowInputsJson);
  if (passportAdapter === null || openAcShow === null) {
    return { ready: false, reason: 'missing-device-public-key' };
  }

  const nonceHash = readU8Array(openAcShow['nonce_hash'], 32);
  if (nonceHash === null) {
    return { ready: false, reason: 'missing-nonce-hash' };
  }

  const adapterPk = readWitnessPublicKey(passportAdapter);
  const showPk = readWitnessPublicKey(openAcShow);
  if (adapterPk === null || showPk === null) {
    return { ready: false, reason: 'missing-device-public-key' };
  }
  if (!bytesEqual(adapterPk, showPk)) {
    return { ready: false, reason: 'device-public-key-mismatch' };
  }

  const signed = await signDeviceDigest(nonceHash);
  if (signed.signature.length !== 64 || signed.publicKeyRaw.length !== 64) {
    return { ready: false, reason: 'invalid-device-signature' };
  }
  if (!bytesEqual(adapterPk, signed.publicKeyRaw)) {
    return { ready: false, reason: 'device-public-key-mismatch' };
  }

  return {
    ready: true,
    witnesses: {
      ...witnesses,
      openAcShowInputsJson: JSON.stringify({
        ...openAcShow,
        signature: Array.from(signed.signature),
      }),
    },
  };
}

export async function generatePassportOpenAcV3ProofPayload(
  args: GeneratePassportOpenAcV3ProofPayloadArgs
): Promise<GeneratePassportOpenAcV3ProofPayloadResult> {
  const proofCalls = buildPassportOpenAcV3ProofCalls(args.plan, args.witnesses);
  const proofs: PassportOpenAcV3EncodedProof[] = [];

  for (const call of proofCalls) {
    args.onProgress?.({ phase: 'generate', circuit: call.circuit });
    const result = await args.prover.generateNoirProof(
      call.circuit.circuitPath,
      call.circuit.srsPath,
      call.inputsJson
    );

    args.onProgress?.({ phase: 'verify', circuit: call.circuit });
    const verified = await args.prover.verifyNoirProof(result.proof, result.vk);
    if (!verified) {
      throw new Error(`${call.circuit.name} proof did not verify`);
    }

    proofs.push({
      circuit: call.circuit.name,
      stage: passportOpenAcV3StageForCircuit(call.circuit.name),
      circuitAsset: call.circuit.circuitAsset,
      srsAsset: call.circuit.srsAsset,
      proofB64: args.encodeProofBytes(result.proof),
      vkB64: args.encodeProofBytes(result.vk),
    });
  }

  const dscChain = findEncodedProof(proofs, 'dsc_chain');
  const passportAdapter = findEncodedProof(proofs, 'passport_adapter');
  const openAcShow = findEncodedProof(proofs, 'openac_show');

  return {
    proofPayload: JSON.stringify({
      proofType: PASSPORT_V3_PROOF_TYPE,
      passportNoirVersion: PASSPORT_NOIR_VERSION,
      proofs,
      phases: {
        prepare: {
          dscChain,
          passportAdapter,
        },
        show: {
          openAcShow,
        },
      },
    }),
    proofs,
  };
}

function passportOpenAcV3StageForCircuit(
  circuit: PassportOpenAcV3CircuitName
): PassportOpenAcV3ProofStage {
  return circuit === 'openac_show' ? 'show' : 'prepare';
}

function findEncodedProof(
  proofs: readonly PassportOpenAcV3EncodedProof[],
  circuit: PassportOpenAcV3CircuitName
): PassportOpenAcV3EncodedProof {
  const proof = proofs.find((candidate) => candidate.circuit === circuit);
  if (proof == null) {
    throw new Error(`missing ${circuit} proof`);
  }
  return proof;
}

function isWitnessInputsJson(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  return parseWitnessInputsRecord(value) !== null;
}

function parseWitnessInputsRecord(value: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return isRecord(parsed) ? parsed : null;
}

function readWitnessPublicKey(record: Record<string, unknown>): Uint8Array | null {
  const x = readU8Array(record['enclave_pk_x'], 32);
  const y = readU8Array(record['enclave_pk_y'], 32);
  if (x === null || y === null) return null;
  const out = new Uint8Array(64);
  out.set(x, 0);
  out.set(y, 32);
  return out;
}

function encodeRequiredDataGroup(
  value: ArrayBuffer | undefined,
  label: PassportOpenAcV3DataGroup
): string {
  if (value === undefined || value.byteLength === 0) {
    throw new Error(`OpenAC v3 witness request missing ${label}`);
  }
  return base64Encode(new Uint8Array(value));
}

function readU8Array(value: unknown, length: number): Uint8Array | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    const item = value[i];
    const n =
      typeof item === 'number'
        ? item
        : typeof item === 'string'
          ? Number.parseInt(item, 10)
          : Number.NaN;
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out[i] = n;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

function missingOpenAcDataGroups(
  dataGroups: PassportReadResult['dataGroups'] | undefined
): PassportOpenAcV3DataGroup[] {
  const missing: PassportOpenAcV3DataGroup[] = [];
  if (!hasBytes(dataGroups?.sod)) missing.push('SOD');
  if (!hasBytes(dataGroups?.dg1)) missing.push('DG1');
  if (!hasBytes(dataGroups?.dg15)) missing.push('DG15');
  return missing;
}

export function isPassportRevocationSnapshot(
  value: unknown
): value is PassportRevocationSnapshot {
  if (!isRecord(value)) return false;
  const sources = value['sources'];
  const entries = value['entries'];
  const sourceCount = value['sourceCount'];
  const revokedCertificateCount = value['revokedCertificateCount'];

  if (value['schema'] !== PASSPORT_REVOCATION_SNAPSHOT_SCHEMA) return false;
  if (!isNonEmptyString(value['generatedAt'])) return false;
  if (!isPositiveInteger(sourceCount)) return false;
  if (!isNonNegativeInteger(revokedCertificateCount)) return false;
  if (!isHex(value['sourceSetSha256'], 64)) return false;
  if (!Array.isArray(sources) || sources.length !== sourceCount) {
    return false;
  }
  if (!Array.isArray(entries) || entries.length !== revokedCertificateCount) {
    return false;
  }

  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!isRevocationSnapshotSource(source)) return false;
    sourceIds.add(source.id);
  }
  for (const entry of entries) {
    if (!isRevocationSnapshotEntry(entry, sourceIds)) return false;
  }
  return true;
}

function isRevocationSnapshotSource(
  source: unknown
): source is PassportRevocationSnapshotSource {
  if (!isRecord(source)) return false;
  return (
    isNonEmptyString(source['id']) &&
    isNonEmptyString(source['uri']) &&
    isNonEmptyString(source['format']) &&
    isHex(source['sha256'], 64) &&
    isPositiveInteger(source['crlCount']) &&
    isNonNegativeInteger(source['revokedCertificateCount'])
  );
}

function isRevocationSnapshotEntry(
  entry: unknown,
  sourceIds: ReadonlySet<string>
): entry is PassportRevocationSnapshotEntry {
  if (!isRecord(entry)) return false;
  const authorityKeyIdentifierHex = entry['authorityKeyIdentifierHex'];
  return (
    isNonEmptyString(entry['sourceId']) &&
    sourceIds.has(entry['sourceId']) &&
    isNonNegativeInteger(entry['crlIndex']) &&
    isNonEmptyString(entry['issuerName']) &&
    isHex(entry['issuerNameSha256'], 64) &&
    (
      authorityKeyIdentifierHex === null ||
      (typeof authorityKeyIdentifierHex === 'string' &&
        authorityKeyIdentifierHex.length > 0 &&
        authorityKeyIdentifierHex.length % 2 === 0 &&
        /^[0-9a-f]+$/i.test(authorityKeyIdentifierHex))
    ) &&
    isHex(entry['serialHex']) &&
    entry['serialHex'].length % 2 === 0 &&
    isHex(entry['serial20Hex'], 40) &&
    (entry['revokedAt'] === null || isNonEmptyString(entry['revokedAt']))
  );
}

function hasBytes(buffer: ArrayBuffer | undefined): boolean {
  return buffer instanceof ArrayBuffer && buffer.byteLength > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isHex(value: unknown, length?: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    (length === undefined || value.length === length) &&
    /^[0-9a-f]+$/i.test(value)
  );
}

function notReady(
  reason: PassportOpenAcV3NotReadyReason,
  missingDataGroups: readonly PassportOpenAcV3DataGroup[]
): PassportOpenAcV3Readiness {
  return {
    ready: false,
    version: PASSPORT_NOIR_VERSION,
    proofType: PASSPORT_V3_PROOF_TYPE,
    reason,
    missingDataGroups,
  };
}
