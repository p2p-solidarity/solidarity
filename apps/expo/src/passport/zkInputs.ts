/**
 * passport-zk witness builder for the v3 `disclosure` circuit.
 *
 *   circuits/disclosure/src/main.nr → fn main(
 *     mrz_data:             [u8; 88],       // private — raw MRZ bytes
 *     mrz_hash:         pub [u8; 32],       // public  — SHA-256(mrz_data)
 *     disclose_nationality: pub bool,
 *     disclose_older_than:  pub bool,
 *     disclose_name:        pub bool,
 *     age_threshold:        pub u8,
 *     current_date:         pub [u8; 6],    // ASCII YYMMDD
 *     out_nationality:      pub [u8; 3],    // disclosed value or 0s
 *     out_name:             pub [u8; 39],   // disclosed value or 0s
 *     out_is_older:         pub bool,
 *   )
 *
 * All inputs derive from `chip.dg1MRZData` + a user-supplied disclosure
 * policy + the current date. No off-chain Merkle proofs or RSA limb
 * encoding is needed — this is what makes `disclosure` the right v3 entry
 * point for end-to-end demonstrations from real chip data, as opposed to
 * `passport_adapter` which additionally requires CSCA Master List
 * Merkle proofs + DSC revocation SMT non-membership.
 */
import { sha256 } from '@noble/hashes/sha2.js';

import type { PassportChipSnapshot } from '@/passport/pipeline';

const MRZ_TOTAL_LEN = 88;
const MRZ_LINE_LEN = 44;
const FILLER_CHAR = 0x3c; // '<' ICAO 9303 filler byte.

/** A name → decimal-string-array map matching mopro's `Map<String, List<String>>`. */
export type WitnessMap = Record<string, readonly string[]>;

/** What the user wants the verifier to learn (and what to hide). */
export interface DisclosurePolicy {
  readonly discloseNationality: boolean;
  readonly discloseOlderThan: boolean;
  readonly discloseName: boolean;
  /** Age the circuit will check `is_older = age >= ageThreshold` against. */
  readonly ageThreshold: number;
}

/**
 * KYC-style default — prove holder is an adult (≥18) of a particular
 * nationality, but never reveal the surname/given-names. Surface this
 * to the verifier UI when no per-request policy is provided.
 */
export const DEFAULT_DISCLOSURE_POLICY: DisclosurePolicy = {
  discloseNationality: true,
  discloseOlderThan: true,
  discloseName: false,
  ageThreshold: 18,
};

export interface BuiltDisclosureWitness {
  readonly inputsJson: string;
  /** Public commitments echoed back so the UI can show what was disclosed. */
  readonly disclosedNationality: string | null;
  readonly disclosedName: string | null;
  readonly isOlder: boolean | null;
  readonly ageThreshold: number;
  /** Hex of `mrz_hash`, useful for chaining to a future prepare/verify step. */
  readonly mrzHashHex: string;
}

/**
 * Build the witness for the v3 disclosure circuit.
 *
 *   - On a real chip, `chip.dg1MRZData` is the 88-char MRZ string parsed
 *     from DG1; we encode it as ASCII bytes and run real disclosure.
 *   - On a simulated chip the MRZ is a single 44-char fallback line;
 *     we pad it to 88 with `<` filler so the circuit accepts the
 *     witness — the resulting proof is still mathematically valid but
 *     attests to synthetic content, which the caller must label as
 *     `trustLevel: 'white'` (CLAUDE.md rule 8).
 */
export function buildDisclosureWitness(
  chip: PassportChipSnapshot,
  policy: DisclosurePolicy = DEFAULT_DISCLOSURE_POLICY,
  now: Date = new Date(),
): BuiltDisclosureWitness {
  const mrzBytes = toMrzBytes(chip.dg1MRZData);

  // Diagnostic: the disclosure circuit's age computation assumes the
  // DOB at mrz_data[57..62] is six ASCII digit bytes (`'0'..'9'`).
  // If chip-side DG1 parsing trimmed the run short and our
  // `toMrzBytes` had to right-pad with `<` (0x3C), the underflow path
  // `100 + curr_yy - birth_yy` inside Noir asserts and the prover
  // returns the generic "Failed assertion" with no field name. Count
  // the non-digit bytes in the DOB slot and log a SHAPE-ONLY warning
  // so we know to look at the chip read instead of the prover.
  // Counts/booleans only — never the actual digits (CLAUDE.md rule 8).
  let dobNonDigits = 0;
  for (let i = 0; i < 6; i += 1) {
    const b = mrzBytes[MRZ_LINE_LEN + 13 + i] ?? 0;
    if (b < 0x30 || b > 0x39) dobNonDigits += 1;
  }
  let natNonAlpha = 0;
  for (let i = 0; i < 3; i += 1) {
    const b = mrzBytes[MRZ_LINE_LEN + 10 + i] ?? 0;
    const isUpper = b >= 0x41 && b <= 0x5a;
    if (!isUpper) natNonAlpha += 1;
  }
  const rawLen = chip.dg1MRZData.length;
  if (dobNonDigits > 0 || natNonAlpha > 0 || rawLen !== MRZ_TOTAL_LEN) {
    console.warn(
      `[zk] disclosure witness SHAPE WARNING — dg1 raw len=${String(rawLen)}/${String(MRZ_TOTAL_LEN)}, ` +
        `DOB non-digits=${String(dobNonDigits)}/6, nationality non-A-Z=${String(natNonAlpha)}/3, ` +
        `simulated=${String(chip.isSimulated)}. ` +
        `Prover will likely "Failed assertion" — check NFC DG1 parse or fall back to SD-JWT.`,
    );
  }


  const mrzHash = sha256(mrzBytes);
  const currentDate = currentDateAscii(now);

  // Nationality lives on line 2 positions 10..12 (3-letter ICAO code).
  const natOffset = MRZ_LINE_LEN + 10;
  const outNationality: Uint8Array = new Uint8Array(3);
  if (policy.discloseNationality) {
    outNationality[0] = mrzBytes[natOffset] ?? 0;
    outNationality[1] = mrzBytes[natOffset + 1] ?? 0;
    outNationality[2] = mrzBytes[natOffset + 2] ?? 0;
  }

  // Name lives on line 1 positions 5..43 (surname<<given_names, 39 bytes).
  const outName: Uint8Array = new Uint8Array(39);
  if (policy.discloseName) {
    outName.set(mrzBytes.slice(5, 5 + 39));
  }

  const outIsOlder = policy.discloseOlderThan
    ? computeIsOlder(mrzBytes, now, policy.ageThreshold)
    : false;

  const inputs: WitnessMap = {
    mrz_data: bytesToDecimalStrings(mrzBytes),
    mrz_hash: bytesToDecimalStrings(mrzHash),
    disclose_nationality: [boolField(policy.discloseNationality)],
    disclose_older_than: [boolField(policy.discloseOlderThan)],
    disclose_name: [boolField(policy.discloseName)],
    age_threshold: [policy.ageThreshold.toString()],
    current_date: bytesToDecimalStrings(currentDate),
    out_nationality: bytesToDecimalStrings(outNationality),
    out_name: bytesToDecimalStrings(outName),
    out_is_older: [boolField(outIsOlder)],
  };

  return {
    inputsJson: JSON.stringify(inputs),
    disclosedNationality: policy.discloseNationality
      ? decodeAsciiTrimmed(outNationality)
      : null,
    disclosedName: policy.discloseName ? decodeMrzName(outName) : null,
    isOlder: policy.discloseOlderThan ? outIsOlder : null,
    ageThreshold: policy.ageThreshold,
    mrzHashHex: bytesToHex(mrzHash),
  };
}

/* ─────── helpers ─────── */

function toMrzBytes(mrz: string): Uint8Array {
  // Filter to MRZ-legal characters then pad/truncate to 88 bytes. We
  // pad with `<` (the ICAO filler) so the SHA-256 commitment matches
  // whatever truncation behaviour upstream might choose later — there's
  // no "MRZ shorter than 88" valid encoding in TD3.
  let filtered = '';
  for (const ch of mrz.toUpperCase()) {
    const code = ch.charCodeAt(0);
    const isDigit = code >= 0x30 && code <= 0x39;
    const isUpper = code >= 0x41 && code <= 0x5a;
    const isFiller = code === FILLER_CHAR;
    if (isDigit || isUpper || isFiller) filtered += ch;
  }
  if (filtered.length > MRZ_TOTAL_LEN) {
    filtered = filtered.slice(0, MRZ_TOTAL_LEN);
  } else if (filtered.length < MRZ_TOTAL_LEN) {
    filtered = filtered.padEnd(MRZ_TOTAL_LEN, '<');
  }
  const out = new Uint8Array(MRZ_TOTAL_LEN);
  for (let i = 0; i < MRZ_TOTAL_LEN; i += 1) {
    out[i] = filtered.charCodeAt(i);
  }
  return out;
}

function currentDateAscii(now: Date): Uint8Array {
  const yy = (now.getUTCFullYear() % 100).toString().padStart(2, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const text = `${yy}${mm}${dd}`;
  const out = new Uint8Array(6);
  for (let i = 0; i < 6; i += 1) out[i] = text.charCodeAt(i);
  return out;
}

function computeIsOlder(
  mrzBytes: Uint8Array,
  now: Date,
  ageThreshold: number,
): boolean {
  // Birth YYMMDD lives at line 2 positions 13..18 — same ASCII encoding
  // as `current_date`, but extracted from the private MRZ bytes.
  const birthOff = MRZ_LINE_LEN + 13;
  const digit = (offset: number): number =>
    (mrzBytes[birthOff + offset] ?? 0x30) - 0x30;
  const birthYy = digit(0) * 10 + digit(1);
  const birthMm = digit(2) * 10 + digit(3);
  const birthDd = digit(4) * 10 + digit(5);

  const currYy = now.getUTCFullYear() % 100;
  const currMm = now.getUTCMonth() + 1;
  const currDd = now.getUTCDate();

  let age = currYy >= birthYy ? currYy - birthYy : 100 + currYy - birthYy;
  const birthdayPassed =
    currMm > birthMm || (currMm === birthMm && currDd >= birthDd);
  if (!birthdayPassed) age -= 1;
  return age >= ageThreshold;
}

function bytesToDecimalStrings(bytes: Uint8Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) out.push((bytes[i] ?? 0).toString());
  return out;
}

function boolField(value: boolean): string {
  return value ? '1' : '0';
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

function decodeAsciiTrimmed(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i] ?? 0;
    if (byte === 0 || byte === FILLER_CHAR) continue;
    out += String.fromCharCode(byte);
  }
  return out;
}

function decodeMrzName(bytes: Uint8Array): string {
  // Surname<<given_names with `<` as space/separator. `<<` separates the
  // surname from given names; single `<` separates given-name tokens.
  let raw = '';
  for (let i = 0; i < bytes.length; i += 1) {
    raw += String.fromCharCode(bytes[i] ?? 0);
  }
  const trimmed = raw.replace(/<+$/, '');
  const [surname, given = ''] = trimmed.split('<<');
  const surnameClean = (surname ?? '').replace(/</g, ' ').trim();
  const givenClean = given.replace(/</g, ' ').trim();
  if (!surnameClean && !givenClean) return '';
  if (!givenClean) return surnameClean;
  return `${givenClean} ${surnameClean}`;
}
