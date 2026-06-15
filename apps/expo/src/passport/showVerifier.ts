/**
 * Passport show-presentation verifier (spec:
 * docs/superpowers/specs/2026-06-12-passport-show-presentation-design.md).
 *
 * Verifies a scanned `passport_show_v1` envelope:
 *   1. vk pin — sha256(vk) must match the build-time pin or the self-pin
 *      recorded at this device's own enrollment (same circuit ⇒ same vk;
 *      trust-on-first-use). Never verifies against an unpinned vk.
 *   2. Public inputs are read from the PROOF BYTES (UltraHonk prepends the
 *      49 public-input fields); the envelope's `publicInputs` are display
 *      data and must match the proof exactly.
 *   3. Freshness: verifier-issued challenge nonce, or the time-bucket
 *      window (current + previous bucket).
 *   4. The native `verifyNoirProof` call is injected so this module stays
 *      unit-testable without the Nitro bridge.
 */
import { base64Decode, bytesToHex, sha256Bytes } from '@solidarity/shared';

import {
  PASSPORT_SHOW_TIME_BUCKET_MINUTES,
  acceptablePassportShowBucketNonceHashes,
  buildPassportShowChallengeJson,
  parsePassportShowEnvelopeJson,
  type PassportShowEnvelope,
  type PassportShowFreshness,
} from '@/passport/showPresentation';
import { PASSPORT_NOIR_VERSION } from '@/passport/openacV3';

/**
 * Public-input field count of `openac_show` in declaration order:
 * credential_type, nonce_hash[32], link_mode, link_scope, epoch,
 * current_year/month/day, age_threshold, disclose_nationality,
 * disclose_age, out_commitment_x/y, out_link_tag, out_is_older,
 * out_nationality[3].
 */
export const PASSPORT_SHOW_PUBLIC_INPUT_FIELD_COUNT = 49;

/** openac_core::commit::DOMAIN_PASSPORT (= 0x01) as a decimal field. */
export const PASSPORT_SHOW_DOMAIN_PASSPORT = '1';

const SCOPE_FIELD_DOMAIN = 'solidarity.openac.scope.v1';
const BN254_FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const FIELD_BYTES = 32;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/**
 * `current_*` public inputs are a UTC-naive calendar date; allow ±48 h so a
 * holder/verifier timezone split around midnight never rejects honestly
 * fresh presentations.
 */
const TODAY_TOLERANCE_MS = 48 * 60 * 60 * 1000;

/** Mirror of the Rust witness builder's `scope_to_field`. */
export function passportScopeToFieldDecimal(scope: string): string {
  const digest = sha256Bytes(`${SCOPE_FIELD_DOMAIN}${scope}`);
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return (value % BN254_FR_MODULUS).toString(10);
}

export interface PassportShowProofPublicInputs {
  readonly credentialType: string;
  readonly nonceHash: Uint8Array;
  readonly linkMode: boolean;
  readonly linkScope: string;
  readonly epoch: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly ageThreshold: number;
  readonly discloseNationality: boolean;
  readonly discloseAge: boolean;
  readonly commitmentX: string;
  readonly commitmentY: string;
  readonly linkTag: string;
  readonly outIsOlder: boolean;
  readonly outNationalityBytes: readonly [number, number, number];
}

/**
 * Decode the public-input block prepended to the proof bytes. Returns null
 * when the proof is too short or a field violates its range (a byte slot
 * > 255, a bool slot not 0/1) — structural sanity, not proof verification.
 */
export function extractPassportShowProofPublicInputs(
  proofBytes: Uint8Array
): PassportShowProofPublicInputs | null {
  if (proofBytes.length < PASSPORT_SHOW_PUBLIC_INPUT_FIELD_COUNT * FIELD_BYTES) {
    return null;
  }
  const field = (index: number): bigint => {
    let value = 0n;
    const offset = index * FIELD_BYTES;
    for (let i = 0; i < FIELD_BYTES; i += 1) {
      value = (value << 8n) | BigInt(proofBytes[offset + i] ?? 0);
    }
    return value;
  };
  const byteField = (index: number): number | null => {
    const value = field(index);
    return value <= 0xffn ? Number(value) : null;
  };
  const boolField = (index: number): boolean | null => {
    const value = field(index);
    if (value === 0n) return false;
    if (value === 1n) return true;
    return null;
  };
  const u32Field = (index: number): number | null => {
    const value = field(index);
    return value <= 0xffff_ffffn ? Number(value) : null;
  };

  const nonceHash = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    const byte = byteField(1 + i);
    if (byte === null) return null;
    nonceHash[i] = byte;
  }
  const linkMode = boolField(33);
  const year = u32Field(36);
  const month = u32Field(37);
  const day = u32Field(38);
  const ageThreshold = u32Field(39);
  const discloseNationality = boolField(40);
  const discloseAge = boolField(41);
  const outIsOlder = boolField(45);
  const nat0 = byteField(46);
  const nat1 = byteField(47);
  const nat2 = byteField(48);
  if (
    linkMode === null ||
    year === null ||
    month === null ||
    day === null ||
    ageThreshold === null ||
    discloseNationality === null ||
    discloseAge === null ||
    outIsOlder === null ||
    nat0 === null ||
    nat1 === null ||
    nat2 === null
  ) {
    return null;
  }
  return {
    credentialType: field(0).toString(10),
    nonceHash,
    linkMode,
    linkScope: field(34).toString(10),
    epoch: field(35).toString(10),
    year,
    month,
    day,
    ageThreshold,
    discloseNationality,
    discloseAge,
    commitmentX: field(42).toString(10),
    commitmentY: field(43).toString(10),
    linkTag: field(44).toString(10),
    outIsOlder,
    outNationalityBytes: [nat0, nat1, nat2],
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type PassportShowFreshnessExpectation =
  | { readonly mode: 'challenge'; readonly expectedNonceHash: Uint8Array }
  | { readonly mode: 'time-bucket'; readonly scope: string; readonly now: Date };

export interface VerifyPassportShowPresentationArgs {
  readonly envelopeJson: string;
  readonly verifyNoirProof: (
    proof: ArrayBuffer,
    vk: ArrayBuffer
  ) => Promise<boolean>;
  readonly vkPins: {
    /** Build-time sha256 hex of the trusted openac_show vk, if shipped. */
    readonly buildPin: string | null;
    /** sha256 hex recorded at this device's own enrollment (TOFU). */
    readonly selfPin: string | null;
  };
  readonly expectedScope: string;
  readonly freshness: PassportShowFreshnessExpectation;
  readonly now: Date;
}

export type PassportShowVerifyFailureReason =
  | 'malformed-envelope'
  | 'unsupported-version'
  | 'missing-vk-pin'
  | 'vk-pin-mismatch'
  | 'invalid-proof-encoding'
  | 'malformed-public-inputs'
  | 'public-input-mismatch'
  | 'wrong-credential-type'
  | 'scope-mismatch'
  | 'nonce-mismatch'
  | 'stale-presentation-date'
  | 'proof-verification-failed';

export type VerifyPassportShowPresentationResult =
  | {
      readonly ok: true;
      readonly envelope: PassportShowEnvelope;
      readonly freshnessMode: PassportShowFreshness;
      readonly disclosed: {
        readonly age: {
          readonly threshold: number;
          readonly satisfied: boolean;
        } | null;
        readonly nationality: string | null;
      };
    }
  | { readonly ok: false; readonly reason: PassportShowVerifyFailureReason };

export async function verifyPassportShowPresentation(
  args: VerifyPassportShowPresentationArgs
): Promise<VerifyPassportShowPresentationResult> {
  const envelope = parsePassportShowEnvelopeJson(args.envelopeJson);
  if (envelope === null) return fail('malformed-envelope');
  if (envelope.passportNoirVersion !== PASSPORT_NOIR_VERSION) {
    return fail('unsupported-version');
  }

  const pin = args.vkPins.buildPin ?? args.vkPins.selfPin;
  if (pin === null || pin.length === 0) return fail('missing-vk-pin');
  const vkBytes = tryBase64(envelope.vkB64);
  const proofBytes = tryBase64(envelope.proofB64);
  if (vkBytes === null || proofBytes === null) {
    return fail('invalid-proof-encoding');
  }
  if (bytesToHex(sha256Bytes(vkBytes)).toLowerCase() !== pin.toLowerCase()) {
    return fail('vk-pin-mismatch');
  }

  const fromProof = extractPassportShowProofPublicInputs(proofBytes);
  if (fromProof === null) return fail('malformed-public-inputs');
  if (!envelopeMatchesProof(envelope, fromProof)) {
    return fail('public-input-mismatch');
  }
  if (fromProof.credentialType !== PASSPORT_SHOW_DOMAIN_PASSPORT) {
    return fail('wrong-credential-type');
  }
  if (fromProof.linkScope !== passportScopeToFieldDecimal(args.expectedScope)) {
    return fail('scope-mismatch');
  }
  if (!nonceAccepted(fromProof.nonceHash, args.freshness)) {
    return fail('nonce-mismatch');
  }
  const presentedAt = Date.UTC(
    fromProof.year,
    fromProof.month - 1,
    fromProof.day
  );
  if (Math.abs(args.now.getTime() - presentedAt) > TODAY_TOLERANCE_MS) {
    return fail('stale-presentation-date');
  }

  const verified = await args.verifyNoirProof(
    toArrayBuffer(proofBytes),
    toArrayBuffer(vkBytes)
  );
  if (!verified) return fail('proof-verification-failed');

  return {
    ok: true,
    envelope,
    freshnessMode: envelope.freshness,
    disclosed: {
      age: fromProof.discloseAge
        ? { threshold: fromProof.ageThreshold, satisfied: fromProof.outIsOlder }
        : null,
      nationality: fromProof.discloseNationality
        ? String.fromCharCode(...fromProof.outNationalityBytes)
        : null,
    },
  };
}

function envelopeMatchesProof(
  envelope: PassportShowEnvelope,
  proof: PassportShowProofPublicInputs
): boolean {
  const claimed = envelope.publicInputs;
  const claimedNonce = tryBase64(claimed.nonceHashB64);
  if (claimedNonce === null || !bytesEqual(claimedNonce, proof.nonceHash)) {
    return false;
  }
  const claimedNationality = claimed.outNationality;
  const proofNationality = proof.discloseNationality
    ? String.fromCharCode(...proof.outNationalityBytes)
    : null;
  return (
    claimed.linkScope === proof.linkScope &&
    claimed.linkMode === proof.linkMode &&
    claimed.epoch === proof.epoch &&
    claimed.today.year === proof.year &&
    claimed.today.month === proof.month &&
    claimed.today.day === proof.day &&
    claimed.ageThreshold === proof.ageThreshold &&
    claimed.discloseAge === proof.discloseAge &&
    claimed.discloseNationality === proof.discloseNationality &&
    claimed.commitmentX === proof.commitmentX &&
    claimed.commitmentY === proof.commitmentY &&
    claimed.linkTag === proof.linkTag &&
    claimed.outIsOlder === proof.outIsOlder &&
    claimedNationality === proofNationality
  );
}

function nonceAccepted(
  nonceHash: Uint8Array,
  expectation: PassportShowFreshnessExpectation
): boolean {
  if (expectation.mode === 'challenge') {
    return bytesEqual(nonceHash, expectation.expectedNonceHash);
  }
  return acceptablePassportShowBucketNonceHashes(
    expectation.scope,
    expectation.now
  ).some((candidate) => bytesEqual(candidate, nonceHash));
}

// ---------------------------------------------------------------------------
// Verifier-side outstanding challenge (single, TTL-bound)
// ---------------------------------------------------------------------------

interface OutstandingChallenge {
  readonly nonceHash: Uint8Array;
  readonly issuedAtMs: number;
}

let outstandingChallenge: OutstandingChallenge | null = null;

export function issuePassportShowChallenge(args: {
  readonly scope: string;
  readonly ageThreshold: number;
  readonly requestAge: boolean;
  readonly requestNationality: boolean;
  /** Injectable for tests; defaults to 32 CSPRNG bytes. */
  readonly nonceHash?: Uint8Array;
  readonly now?: Date;
}): { readonly challengeJson: string; readonly nonceHash: Uint8Array } {
  const nonceHash = args.nonceHash ?? randomNonceHash();
  const now = args.now ?? new Date();
  outstandingChallenge = { nonceHash, issuedAtMs: now.getTime() };
  return {
    challengeJson: buildPassportShowChallengeJson({
      nonceHash,
      scope: args.scope,
      ageThreshold: args.ageThreshold,
      requestAge: args.requestAge,
      requestNationality: args.requestNationality,
      issuedAt: now.toISOString(),
    }),
    nonceHash,
  };
}

/** Take (and clear) the outstanding challenge nonce if it has not expired. */
export function consumePassportShowChallenge(now?: Date): Uint8Array | null {
  const challenge = outstandingChallenge;
  outstandingChallenge = null;
  if (challenge === null) return null;
  const ageMs = (now ?? new Date()).getTime() - challenge.issuedAtMs;
  if (ageMs < 0 || ageMs > CHALLENGE_TTL_MS) return null;
  return challenge.nonceHash;
}

export function peekPassportShowChallenge(now?: Date): Uint8Array | null {
  const challenge = outstandingChallenge;
  if (challenge === null) return null;
  const ageMs = (now ?? new Date()).getTime() - challenge.issuedAtMs;
  if (ageMs < 0 || ageMs > CHALLENGE_TTL_MS) return null;
  return challenge.nonceHash;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Bucket math sanity export for UI copy ("有效 ~N 分鐘"). */
export const PASSPORT_SHOW_BUCKET_WINDOW_MINUTES =
  PASSPORT_SHOW_TIME_BUCKET_MINUTES * 2;

function fail(
  reason: PassportShowVerifyFailureReason
): VerifyPassportShowPresentationResult {
  return { ok: false, reason };
}

function tryBase64(value: string): Uint8Array | null {
  try {
    return base64Decode(value);
  } catch {
    return null;
  }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.length);
  new Uint8Array(out).set(bytes);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

function randomNonceHash(): Uint8Array {
  const bytes = new Uint8Array(32);
  const cryptoLike = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (typeof cryptoLike?.getRandomValues === 'function') {
    cryptoLike.getRandomValues(bytes);
    return bytes;
  }
  return sha256Bytes(`solidarity-show-challenge:${String(Date.now())}:${Math.random().toString(36)}`);
}
