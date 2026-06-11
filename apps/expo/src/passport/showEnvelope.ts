/**
 * Wire formats for passport show presentations (spec:
 * docs/superpowers/specs/2026-06-12-passport-show-presentation-design.md):
 * the `passport_show_v1` presentation envelope, the verifier challenge QR
 * payload, and the time-bucket freshness nonce. Pure data — the proving /
 * verifying logic lives in showPresentation.ts / showVerifier.ts.
 */
import { base64Decode, base64Encode, sha256Bytes } from '@solidarity/shared';

import { PASSPORT_NOIR_VERSION } from '@/passport/openacV3';

export const PASSPORT_SHOW_PRESENTATION_SCHEMA =
  'gg.solidarity.passport.show-presentation.v1' as const;
export const PASSPORT_SHOW_CHALLENGE_SCHEMA =
  'gg.solidarity.passport.show-challenge.v1' as const;
export const PASSPORT_SHOW_PROOF_TYPE = 'passport_show_v1' as const;
export const PASSPORT_SHOW_TIME_BUCKET_DOMAIN =
  'solidarity.passport.show.bucket.v1' as const;
export const PASSPORT_SHOW_TIME_BUCKET_MINUTES = 10;

/**
 * Single app-wide link scope. Pinned at enrollment into the prepare-phase
 * commitment (per-scope pseudonym), so every show proof must use the same
 * value — and the verifier pins it.
 */
export const PASSPORT_SHOW_LINK_SCOPE = 'airmeishi-passport-v3' as const;

export type PassportShowFreshness = 'challenge' | 'time-bucket';

export interface PassportShowToday {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface PassportShowPublicInputs {
  readonly nonceHashB64: string;
  readonly linkScope: string;
  readonly linkMode: boolean;
  readonly epoch: string;
  readonly today: PassportShowToday;
  readonly ageThreshold: number;
  readonly discloseAge: boolean;
  readonly discloseNationality: boolean;
  readonly commitmentX: string;
  readonly commitmentY: string;
  readonly linkTag: string;
  readonly outIsOlder: boolean;
  /** ICAO alpha-3 when disclosed, null when the sentinel zeros are pinned. */
  readonly outNationality: string | null;
}

export interface PassportShowChallenge {
  readonly schema: typeof PASSPORT_SHOW_CHALLENGE_SCHEMA;
  readonly nonceHashB64: string;
  readonly scope: string;
  readonly ageThreshold: number;
  readonly requestAge: boolean;
  readonly requestNationality: boolean;
  readonly issuedAt: string;
}

export interface PassportShowEnvelope {
  readonly schema: typeof PASSPORT_SHOW_PRESENTATION_SCHEMA;
  readonly proofType: typeof PASSPORT_SHOW_PROOF_TYPE;
  readonly passportNoirVersion: string;
  readonly circuit: 'openac_show';
  readonly proofB64: string;
  readonly vkB64: string;
  readonly publicInputs: PassportShowPublicInputs;
  readonly freshness: PassportShowFreshness;
  readonly holderDid: string;
  readonly selectedClaims: readonly string[];
}

// ---------------------------------------------------------------------------
// Verifier challenge (single-frame QR payload)
// ---------------------------------------------------------------------------

export function buildPassportShowChallengeJson(args: {
  readonly nonceHash: Uint8Array;
  readonly scope: string;
  readonly ageThreshold: number;
  readonly requestAge: boolean;
  readonly requestNationality: boolean;
  readonly issuedAt: string;
}): string {
  if (args.nonceHash.length !== 32) {
    throw new Error('passport show challenge requires a 32-byte nonce hash');
  }
  const challenge: PassportShowChallenge = {
    schema: PASSPORT_SHOW_CHALLENGE_SCHEMA,
    nonceHashB64: base64Encode(args.nonceHash),
    scope: args.scope,
    ageThreshold: args.ageThreshold,
    requestAge: args.requestAge,
    requestNationality: args.requestNationality,
    issuedAt: args.issuedAt,
  };
  return JSON.stringify(challenge);
}

export function parsePassportShowChallengeJson(
  payload: string
): PassportShowChallenge | null {
  const record = parseJsonRecord(payload);
  if (record === null) return null;
  if (record['schema'] !== PASSPORT_SHOW_CHALLENGE_SCHEMA) return null;
  const strings = pickNonEmptyStrings(record, [
    'nonceHashB64',
    'scope',
    'issuedAt',
  ]);
  const bools = pickBooleans(record, ['requestAge', 'requestNationality']);
  const ageThreshold = record['ageThreshold'];
  if (
    strings === null ||
    bools === null ||
    typeof ageThreshold !== 'number' ||
    !Number.isInteger(ageThreshold) ||
    ageThreshold <= 0 ||
    decode32(strings.nonceHashB64) === null
  ) {
    return null;
  }
  return {
    schema: PASSPORT_SHOW_CHALLENGE_SCHEMA,
    nonceHashB64: strings.nonceHashB64,
    scope: strings.scope,
    ageThreshold,
    requestAge: bools.requestAge,
    requestNationality: bools.requestNationality,
    issuedAt: strings.issuedAt,
  };
}

// ---------------------------------------------------------------------------
// Time-bucket freshness (challenge-less mode; replayable within the window,
// the envelope labels it so the verifier UI shows the weaker guarantee)
// ---------------------------------------------------------------------------

export function derivePassportShowBucketNonceHash(
  scope: string,
  date: Date
): Uint8Array {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const bucket = Math.floor(
    date.getUTCMinutes() / PASSPORT_SHOW_TIME_BUCKET_MINUTES
  );
  return sha256Bytes(
    `${PASSPORT_SHOW_TIME_BUCKET_DOMAIN}|${scope}|${String(yyyy)}-${mm}-${dd}|${hh}|${String(bucket)}`
  );
}

/** Current and previous bucket — rolls over hour/day boundaries naturally. */
export function acceptablePassportShowBucketNonceHashes(
  scope: string,
  now: Date
): readonly Uint8Array[] {
  const previous = new Date(
    now.getTime() - PASSPORT_SHOW_TIME_BUCKET_MINUTES * 60 * 1000
  );
  return [
    derivePassportShowBucketNonceHash(scope, now),
    derivePassportShowBucketNonceHash(scope, previous),
  ];
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export function buildPassportShowEnvelopeJson(args: {
  readonly proofB64: string;
  readonly vkB64: string;
  readonly publicInputs: PassportShowPublicInputs;
  readonly freshness: PassportShowFreshness;
  readonly holderDid: string;
  readonly selectedClaims: readonly string[];
}): string {
  const envelope: PassportShowEnvelope = {
    schema: PASSPORT_SHOW_PRESENTATION_SCHEMA,
    proofType: PASSPORT_SHOW_PROOF_TYPE,
    passportNoirVersion: PASSPORT_NOIR_VERSION,
    circuit: 'openac_show',
    proofB64: args.proofB64,
    vkB64: args.vkB64,
    publicInputs: args.publicInputs,
    freshness: args.freshness,
    holderDid: args.holderDid,
    selectedClaims: args.selectedClaims,
  };
  return JSON.stringify(envelope);
}

export function parsePassportShowEnvelopeJson(
  json: string
): PassportShowEnvelope | null {
  const record = parseJsonRecord(json);
  if (record === null) return null;
  if (record['schema'] !== PASSPORT_SHOW_PRESENTATION_SCHEMA) return null;
  if (record['proofType'] !== PASSPORT_SHOW_PROOF_TYPE) return null;
  if (record['circuit'] !== 'openac_show') return null;
  const strings = pickNonEmptyStrings(record, [
    'passportNoirVersion',
    'proofB64',
    'vkB64',
    'holderDid',
  ]);
  const freshness = record['freshness'];
  const selectedClaims = record['selectedClaims'];
  const publicInputs = parsePublicInputs(record['publicInputs']);
  if (
    strings === null ||
    (freshness !== 'challenge' && freshness !== 'time-bucket') ||
    !isStringArray(selectedClaims) ||
    publicInputs === null
  ) {
    return null;
  }
  return {
    schema: PASSPORT_SHOW_PRESENTATION_SCHEMA,
    proofType: PASSPORT_SHOW_PROOF_TYPE,
    passportNoirVersion: strings.passportNoirVersion,
    circuit: 'openac_show',
    proofB64: strings.proofB64,
    vkB64: strings.vkB64,
    publicInputs,
    freshness,
    holderDid: strings.holderDid,
    selectedClaims,
  };
}

function parsePublicInputs(value: unknown): PassportShowPublicInputs | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const strings = pickNonEmptyStrings(record, [
    'nonceHashB64',
    'linkScope',
    'epoch',
    'commitmentX',
    'commitmentY',
    'linkTag',
  ]);
  const bools = pickBooleans(record, [
    'linkMode',
    'discloseAge',
    'discloseNationality',
    'outIsOlder',
  ]);
  const today = parseToday(record['today']);
  const ageThreshold = record['ageThreshold'];
  const outNationalityRaw = record['outNationality'];
  // `outNationality` is tri-state on the wire: null (sentinel) or a
  // non-empty string; anything else is malformed (undefined sentinel below).
  const outNationality =
    outNationalityRaw === null
      ? null
      : isNonEmptyString(outNationalityRaw)
        ? outNationalityRaw
        : undefined;
  if (
    strings === null ||
    bools === null ||
    today === null ||
    typeof ageThreshold !== 'number' ||
    decode32(strings.nonceHashB64) === null ||
    outNationality === undefined
  ) {
    return null;
  }
  return {
    nonceHashB64: strings.nonceHashB64,
    linkScope: strings.linkScope,
    linkMode: bools.linkMode,
    epoch: strings.epoch,
    today,
    ageThreshold,
    discloseAge: bools.discloseAge,
    discloseNationality: bools.discloseNationality,
    commitmentX: strings.commitmentX,
    commitmentY: strings.commitmentY,
    linkTag: strings.linkTag,
    outIsOlder: bools.outIsOlder,
    outNationality,
  };
}

function parseToday(value: unknown): PassportShowToday | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const year = record['year'];
  const month = record['month'];
  const day = record['day'];
  if (
    typeof year !== 'number' ||
    typeof month !== 'number' ||
    typeof day !== 'number'
  ) {
    return null;
  }
  return { year, month, day };
}

// ---------------------------------------------------------------------------
// Shared parsing helpers (exported for showPresentation.ts)
// ---------------------------------------------------------------------------

export function pickNonEmptyStrings<K extends string>(
  record: Record<string, unknown>,
  keys: readonly K[]
): Record<K, string> | null {
  const out = {} as Record<K, string>;
  for (const key of keys) {
    const value = record[key];
    if (!isNonEmptyString(value)) return null;
    out[key] = value;
  }
  return out;
}

export function pickBooleans<K extends string>(
  record: Record<string, unknown>,
  keys: readonly K[]
): Record<K, boolean> | null {
  const out = {} as Record<K, boolean>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'boolean') return null;
    out[key] = value;
  }
  return out;
}

export function decode32(value: string): Uint8Array | null {
  try {
    const bytes = base64Decode(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

export function parseJsonRecord(json: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
