/**
 * mrzOcr — pure-JS MRZ recognition + N-frame consensus.
 *
 * Sits between the `@solidarity/nitro-mrz-ocr` Nitro plugin (which only
 * returns raw OCR'd lines) and the onboarding screen (which wants a
 * validated, draft-shaped `PassportMRZDraft`).
 *
 * Two pieces:
 *   1. `parseMrzLines(lines)` — filter to MRZ-looking rows, pick the two
 *      longest, run the `mrz` package, reject on any check-digit failure,
 *      and map the valid result to our compact draft shape.
 *   2. `MrzFrameConsensus` — small stateful aggregator that returns the
 *      draft once it has appeared 3 frames in a row with identical
 *      fields. A null frame (failed parse) resets the streak; we never
 *      ship a partial / guessed draft (CLAUDE.md rule 8).
 *
 * No PII logs anywhere.
 */
import { parse } from 'mrz';

import type { PassportMRZDraft } from '@/onboarding/steps/MRZCameraStep';

/** Lines that *could* be MRZ rows — A–Z, 0–9, `<` filler, 30..44 chars. */
const MRZ_LINE_RE = /^[A-Z0-9<]{30,44}$/;

/** Streak length required before we trust a draft (rule 8: no fake data). */
const CONSENSUS_THRESHOLD = 3;

/** Bounded ring length — never grow unbounded. */
const CONSENSUS_WINDOW = 4;

/**
 * Cheap "do these recognised lines contain anything MRZ-shaped?" probe.
 * Drives the live "detecting" affordance (green sketch frame) so the user
 * gets feedback the instant the camera sees a candidate row — well before
 * the 3-frame check-digit consensus required by `parseMrzLines`.
 *
 * Caveat per CLAUDE.md rule 8: a green frame here is NOT a claim that the
 * MRZ has been *parsed* — only that text in MRZ shape is on screen. The
 * confirmation card is still gated on `parseMrzLines` + consensus.
 */
export function hasMrzCandidate(lines: readonly string[]): boolean {
  for (const line of lines) {
    const normalised = line.toUpperCase().replace(/\s+/g, '');
    if (MRZ_LINE_RE.test(normalised)) return true;
  }
  return false;
}

/**
 * Filter, pick the two longest MRZ-shaped lines, run the `mrz` parser,
 * and return a validated `PassportMRZDraft` or `null` if anything
 * (line count, check digits, required fields) fails.
 */
export function parseMrzLines(
  lines: readonly string[],
): PassportMRZDraft | null {
  // 1. Normalise + filter.
  const candidates = lines
    .map((line) => line.toUpperCase().replace(/\s+/g, ''))
    .filter((line) => MRZ_LINE_RE.test(line));

  if (candidates.length < 2) return null;

  // 2. TD3 = two 44-char rows. Take the two longest (longest first,
  // tie-broken by input order via stable sort).
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const lineA = sorted[0];
  const lineB = sorted[1];
  if (lineA === undefined || lineB === undefined) return null;

  // 3. Run the `mrz` parser — it throws on totally-unknown formats.
  let result: ReturnType<typeof parse>;
  try {
    result = parse([lineA, lineB]);
  } catch {
    return null;
  }
  if (result.valid !== true) return null;

  // 4. Belt-and-suspenders — even if `valid === true`, every detail
  // must individually pass before we trust the draft.
  for (const detail of result.details) {
    if (detail.valid !== true) return null;
  }

  // 5. Pull the four fields we surface. All come back as strings (or
  // null). Birth + expiration are YYMMDD per ICAO 9303 (verified
  // against node_modules/mrz/lib/parsers/parseDate.js).
  const passportNumber = result.fields.documentNumber;
  const nationalityCode = result.fields.nationality;
  const dateOfBirth = result.fields.birthDate;
  const expiryDate = result.fields.expirationDate;

  if (
    passportNumber == null ||
    nationalityCode == null ||
    dateOfBirth == null ||
    expiryDate == null
  ) {
    return null;
  }
  if (dateOfBirth.length !== 6 || expiryDate.length !== 6) return null;

  return {
    passportNumber,
    nationalityCode,
    dateOfBirth,
    expiryDate,
  };
}

function draftsEqual(
  a: PassportMRZDraft,
  b: PassportMRZDraft,
): boolean {
  return (
    a.passportNumber === b.passportNumber &&
    a.nationalityCode === b.nationalityCode &&
    a.dateOfBirth === b.dateOfBirth &&
    a.expiryDate === b.expiryDate
  );
}

/**
 * N-frame consensus aggregator. The same `PassportMRZDraft` must appear
 * three times in a row before we accept it; any null / mismatched draft
 * breaks the streak. Bounded history prevents unbounded growth.
 */
export class MrzFrameConsensus {
  private readonly history: PassportMRZDraft[] = [];
  private streakDraft: PassportMRZDraft | null = null;
  private streakLength = 0;

  ingest(draft: PassportMRZDraft | null): PassportMRZDraft | null {
    if (draft === null) {
      this.streakDraft = null;
      this.streakLength = 0;
      return null;
    }

    this.history.push(draft);
    if (this.history.length > CONSENSUS_WINDOW) this.history.shift();

    if (this.streakDraft !== null && draftsEqual(this.streakDraft, draft)) {
      this.streakLength += 1;
    } else {
      this.streakDraft = draft;
      this.streakLength = 1;
    }

    return this.streakLength >= CONSENSUS_THRESHOLD ? draft : null;
  }

  reset(): void {
    this.history.length = 0;
    this.streakDraft = null;
    this.streakLength = 0;
  }
}
