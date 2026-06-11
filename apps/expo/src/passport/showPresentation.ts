/**
 * Passport show-phase presentation (spec:
 * docs/superpowers/specs/2026-06-12-passport-show-presentation-design.md).
 *
 * Builds the per-presentation `openac_show` proof from the vaulted witness
 * bundle: swap `nonce_hash` / today / disclosure flags, re-sign with the
 * Secure-Enclave key, prove the small show circuit only, and emit the
 * `passport_show_v1` envelope (one proof + one vk — no prepare proofs).
 *
 * Wire formats (envelope / challenge / time-bucket) live in showEnvelope.ts
 * and are re-exported here so callers have a single import surface.
 *
 * Everything here is pure TS so it unit-tests without the Nitro bridge;
 * the prover and device signer are injected with the same interfaces the
 * enrollment path uses (`PassportOpenAcV3Prover` / `...DeviceSigner`).
 */
import { base64Decode, base64Encode, bytesToHex, sha256Bytes } from '@solidarity/shared';

import {
  PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS,
  bindPassportOpenAcV3DeviceSignature,
  parsePassportOpenAcV3WitnessBundleJson,
  type PassportOpenAcV3DeviceSigner,
  type PassportOpenAcV3Prover,
} from '@/passport/openacV3';
import {
  buildPassportShowEnvelopeJson,
  isNonEmptyString,
  isStringArray,
  parseJsonRecord,
  type PassportShowFreshness,
  type PassportShowPublicInputs,
  type PassportShowToday,
} from '@/passport/showEnvelope';
import { isPassportShowClaimType } from '@/passport/presentationClaims';

export * from '@/passport/showEnvelope';

export interface PassportShowDisclosure {
  readonly discloseAge: boolean;
  readonly discloseNationality: boolean;
}

export interface PassportClaimsProfile {
  readonly birthYear: number;
  readonly birthMonth: number;
  readonly birthDay: number;
  readonly nationalityBytes: readonly [number, number, number];
  readonly nationality: string;
}

// ---------------------------------------------------------------------------
// Claims field (openac_core::profile::pack_passport_claims, 72-bit BE pack)
// ---------------------------------------------------------------------------

const CLAIMS_FIELD_MAX = 1n << 72n;

export function decodePassportClaimsField(
  value: string
): PassportClaimsProfile | null {
  if (!/^\d+$/.test(value)) return null;
  const packed = BigInt(value);
  if (packed < 0n || packed >= CLAIMS_FIELD_MAX) return null;
  const birthYear = Number(packed >> 40n);
  const birthMonth = Number((packed >> 32n) & 0xffn);
  const birthDay = Number((packed >> 24n) & 0xffn);
  const nationalityBytes: [number, number, number] = [
    Number((packed >> 16n) & 0xffn),
    Number((packed >> 8n) & 0xffn),
    Number(packed & 0xffn),
  ];
  return {
    birthYear,
    birthMonth,
    birthDay,
    nationalityBytes,
    nationality: String.fromCharCode(...nationalityBytes),
  };
}

/**
 * Mirror of `openac_core::predicate::check_age_above`, including the HIGH-2
 * guard: a same-year birthday in the future leaves age at 0 (never wraps).
 * Must stay semantically identical to the circuit or honest witnesses fail
 * the in-circuit `is_older == out_is_older` assert.
 */
export function isPassportAgeAtLeast(
  profile: Pick<PassportClaimsProfile, 'birthYear' | 'birthMonth' | 'birthDay'>,
  today: PassportShowToday,
  threshold: number
): boolean {
  if (today.year < profile.birthYear) return false;
  let age = today.year - profile.birthYear;
  const birthdayNotYet =
    today.month < profile.birthMonth ||
    (today.month === profile.birthMonth && today.day < profile.birthDay);
  if (birthdayNotYet && age > 0) age -= 1;
  return age >= threshold;
}

// ---------------------------------------------------------------------------
// Witness input swap
// ---------------------------------------------------------------------------

export type SwapPassportShowInputsResult =
  | {
      readonly ok: true;
      readonly showInputsJson: string;
      readonly publicInputs: PassportShowPublicInputs;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid-show-inputs'
        | 'invalid-nonce-hash'
        | 'invalid-claims';
    };

/** Keys the swap reads or rewrites — all must exist in the vaulted map. */
const REQUIRED_SHOW_INPUT_KEYS = [
  'claims',
  'nonce_hash',
  'link_mode',
  'link_scope',
  'epoch',
  'current_year',
  'current_month',
  'current_day',
  'age_threshold',
  'disclose_nationality',
  'disclose_age',
  'out_commitment_x',
  'out_commitment_y',
  'out_link_tag',
  'out_is_older',
  'out_nationality',
] as const;

export function swapPassportShowInputs(args: {
  readonly showInputsJson: string;
  readonly nonceHash: Uint8Array;
  readonly today: PassportShowToday;
  readonly disclosure: PassportShowDisclosure;
}): SwapPassportShowInputsResult {
  if (args.nonceHash.length !== 32) {
    return { ok: false, reason: 'invalid-nonce-hash' };
  }
  const map = parseShowInputsMap(args.showInputsJson);
  if (map === null) return { ok: false, reason: 'invalid-show-inputs' };

  const claimsValue = map['claims']?.[0];
  const profile =
    claimsValue !== undefined ? decodePassportClaimsField(claimsValue) : null;
  if (profile === null) return { ok: false, reason: 'invalid-claims' };

  const ageThreshold = Number.parseInt(map['age_threshold']?.[0] ?? '', 10);
  if (!Number.isInteger(ageThreshold) || ageThreshold <= 0) {
    return { ok: false, reason: 'invalid-show-inputs' };
  }

  const { discloseAge, discloseNationality } = args.disclosure;
  const outIsOlder =
    discloseAge && isPassportAgeAtLeast(profile, args.today, ageThreshold);
  const outNationality: readonly string[] = discloseNationality
    ? profile.nationalityBytes.map(String)
    : ['0', '0', '0'];

  const swapped: Record<string, readonly string[]> = {
    ...map,
    nonce_hash: Array.from(args.nonceHash, String),
    current_year: [String(args.today.year)],
    current_month: [String(args.today.month)],
    current_day: [String(args.today.day)],
    disclose_age: [discloseAge ? '1' : '0'],
    disclose_nationality: [discloseNationality ? '1' : '0'],
    out_is_older: [outIsOlder ? '1' : '0'],
    out_nationality: outNationality,
  };

  return {
    ok: true,
    showInputsJson: JSON.stringify(swapped),
    publicInputs: publicInputsFromSwap({
      map,
      nonceHash: args.nonceHash,
      today: args.today,
      ageThreshold,
      disclosure: args.disclosure,
      outIsOlder,
      nationality: discloseNationality ? profile.nationality : null,
    }),
  };
}

function publicInputsFromSwap(args: {
  readonly map: Record<string, readonly string[]>;
  readonly nonceHash: Uint8Array;
  readonly today: PassportShowToday;
  readonly ageThreshold: number;
  readonly disclosure: PassportShowDisclosure;
  readonly outIsOlder: boolean;
  readonly nationality: string | null;
}): PassportShowPublicInputs {
  const first = (key: string): string => args.map[key]?.[0] ?? '';
  return {
    nonceHashB64: base64Encode(args.nonceHash),
    linkScope: first('link_scope'),
    linkMode: first('link_mode') === '1',
    epoch: first('epoch'),
    today: args.today,
    ageThreshold: args.ageThreshold,
    discloseAge: args.disclosure.discloseAge,
    discloseNationality: args.disclosure.discloseNationality,
    commitmentX: first('out_commitment_x'),
    commitmentY: first('out_commitment_y'),
    linkTag: first('out_link_tag'),
    outIsOlder: args.outIsOlder,
    outNationality: args.nationality,
  };
}

function parseShowInputsMap(json: string): Record<string, string[]> | null {
  const record = parseJsonRecord(json);
  if (record === null) return null;
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!isStringArray(value)) return null;
    out[key] = [...value];
  }
  for (const key of REQUIRED_SHOW_INPUT_KEYS) {
    if (!Array.isArray(out[key]) || out[key].length === 0) return null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Enrollment vk self-pin
// ---------------------------------------------------------------------------

/**
 * Pull the `openac_show` vk out of an enrollment `passport_v3` proof payload
 * and hash it (sha256 hex). Recorded at enrollment as the verifier self-pin:
 * same circuit + SRS ⇒ same vk, so this device can trust-on-first-use other
 * holders' presentations even before a build-time pin ships.
 */
export function extractPassportShowVkSha256FromProofPayload(
  proofPayload: string
): string | null {
  const record = parseJsonRecord(proofPayload);
  if (record === null) return null;
  const proofs = record['proofs'];
  if (!Array.isArray(proofs)) return null;
  for (const entry of proofs) {
    if (typeof entry !== 'object' || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (candidate['circuit'] !== 'openac_show') continue;
    const vkB64 = candidate['vkB64'];
    if (!isNonEmptyString(vkB64)) return null;
    try {
      return bytesToHex(sha256Bytes(base64Decode(vkB64)));
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Generation orchestrator (holder side)
// ---------------------------------------------------------------------------

export interface GeneratePassportShowPresentationArgs {
  readonly witnessBundleJson: string;
  readonly nonceHash: Uint8Array;
  readonly today: PassportShowToday;
  readonly disclosure: PassportShowDisclosure;
  readonly freshness: PassportShowFreshness;
  readonly holderDid: string;
  readonly selectedClaims: readonly string[];
  readonly signDeviceDigest: PassportOpenAcV3DeviceSigner;
  readonly prover: PassportOpenAcV3Prover;
  readonly encodeProofBytes: (buffer: ArrayBuffer) => string;
}

export async function generatePassportShowPresentation(
  args: GeneratePassportShowPresentationArgs
): Promise<{ readonly envelopeJson: string }> {
  const bundle = parsePassportOpenAcV3WitnessBundleJson(args.witnessBundleJson);
  if (bundle === null) {
    throw new Error('passport show witness bundle is missing or malformed');
  }

  const swapped = swapPassportShowInputs({
    showInputsJson: bundle.openAcShowInputsJson,
    nonceHash: args.nonceHash,
    today: args.today,
    disclosure: args.disclosure,
  });
  if (!swapped.ok) {
    throw new Error(`passport show input swap failed: ${swapped.reason}`);
  }

  const bound = await bindPassportOpenAcV3DeviceSignature(
    { ...bundle, openAcShowInputsJson: swapped.showInputsJson },
    args.signDeviceDigest
  );
  if (!bound.ready) {
    throw new Error(`passport show device binding failed: ${bound.reason}`);
  }

  const proof = await args.prover.generateNoirProof(
    'openac_show',
    PASSPORT_OPENAC_V3_MERGED_SRS_ALIAS,
    bound.witnesses.openAcShowInputsJson
  );
  const verified = await args.prover.verifyNoirProof(proof.proof, proof.vk);
  if (!verified) {
    throw new Error('openac_show presentation proof did not verify');
  }

  return {
    envelopeJson: buildPassportShowEnvelopeJson({
      proofB64: args.encodeProofBytes(proof.proof),
      vkB64: args.encodeProofBytes(proof.vk),
      publicInputs: swapped.publicInputs,
      freshness: args.freshness,
      holderDid: args.holderDid,
      selectedClaims: args.selectedClaims.filter(isPassportShowClaimType),
    }),
  };
}
