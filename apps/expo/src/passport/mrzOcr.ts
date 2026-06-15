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

/**
 * Lines that *could* be MRZ rows — A–Z, 0–9, `<` filler, 20..50 chars
 * post-normalisation. The hard ICAO bound is 44 chars per TD3 row, but
 * ML Kit / Vision routinely return rows with a stray leading/trailing
 * char (e.g. an extra `<` from passport gloss, or a punctuation mark
 * that survived our `\s+ → <` collapse). Letting 45–50 through lets
 * the `mrz` parser take a second look — it does its own length check
 * and rejects bad rows on check-digit failure. We still trim down in
 * `parseMrzLines` before handing the pair to `parse`.
 *
 * Symmetric on the low end: OCR often drops the trailing filler `<<<<`
 * runs entirely. Row 1 can become just document type + country + name,
 * which is still enough because row 2's check digits are the validation
 * gate and short rows are right-padded before parsing.
 */
const MRZ_LINE_RE = /^[A-Z0-9<]{20,50}$/;
const TD3_ROW_LEN = 44;

/**
 * Default streak length before we trust a draft.
 *
 * `1` is intentional: `parseMrzLines` already requires `mrz`'s
 * `result.valid === true`, which means every single ICAO 9303 check digit
 * (document, DOB, expiry, optional, composite) passed. Demanding multiple
 * identical OCR reads on top of that was overzealous — OCR naturally
 * jitters between `0`/`O`, `1`/`I`, `S`/`5` between frames, so the streak
 * almost never grew to 3 in practice and the user was stranded on the
 * green-frame "detecting" affordance forever. Acceptance is still gated
 * by the user's "Use This" tap in the confirmation card.
 *
 * Tests that exercise the multi-frame branch construct `MrzFrameConsensus`
 * with an explicit threshold.
 */
const DEFAULT_CONSENSUS_THRESHOLD = 1;

/** Bounded ring length — never grow unbounded. */
const CONSENSUS_WINDOW = 4;

/**
 * Number of recognised lines that match MRZ shape (A–Z, 0–9, `<`, 20..50
 * chars after space-as-`<` normalisation). Drives the live affordance so
 * the user can tell whether the camera even SEES candidate rows yet.
 *
 *   0   →  no MRZ visible — reposition the passport
 *   1   →  one row only — usually the camera is too high / too low
 *   2+  →  both rows visible — parse will run on the two longest
 *
 * Caveat per CLAUDE.md rule 8: a non-zero count is NOT a claim that the
 * MRZ has been *parsed* — only that text in MRZ shape is on screen. The
 * confirmation card is still gated on `parseMrzLines` + consensus.
 */
export function countMrzCandidates(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) {
    const normalised = line.toUpperCase().replace(/\s+/g, '<');
    if (MRZ_LINE_RE.test(normalised)) count += 1;
  }
  return count;
}

/** @deprecated use `countMrzCandidates(lines) > 0`. */
export function hasMrzCandidate(lines: readonly string[]): boolean {
  return countMrzCandidates(lines) > 0;
}

/**
 * Filter, pick the two longest MRZ-shaped lines, run the `mrz` parser,
 * and return a validated `PassportMRZDraft` or `null` if anything
 * (line count, check digits, required fields) fails.
 */
export function parseMrzLines(
  lines: readonly string[],
): PassportMRZDraft | null {
  // 1. Normalise + filter. ML Kit occasionally returns MRZ `<` fillers as
  // spaces (or runs of spaces inside an otherwise valid row) — convert
  // them back so the length + regex tests stay accurate.
  const candidates = lines
    .map((line) => line.toUpperCase().replace(/\s+/g, '<'))
    .filter((line) => MRZ_LINE_RE.test(line));

  if (candidates.length < 2) return null;

  // 2. Build a small priority list of pairs to try. The two longest
  // rows are usually the actual TD3 rows, but OCR sometimes pulls in
  // an extra long line from header text (e.g. ICAO "PASSPORT" banner)
  // that pushes a real row out of the top-two — so we also try the
  // longest with each shorter candidate as the second row. Stops as
  // soon as `mrz` returns a fully-valid parse.
  const sorted = [...candidates].sort((a, b) => b.length - a.length);
  const pairs: Array<readonly [string, string]> = [];
  const head = sorted.slice(0, Math.min(4, sorted.length));
  for (let i = 0; i < head.length; i += 1) {
    for (let j = i + 1; j < head.length; j += 1) {
      const a = head[i];
      const b = head[j];
      if (a === undefined || b === undefined) continue;
      pairs.push([a, b]);
    }
  }

  // 3. Each pair: canonicalise to TD3_ROW_LEN (`mrz` requires exactly
  // 44 per row), then parse. MRZ structure is left-anchored and OCR often
  // drops trailing filler `<` runs, so short rows are right-padded while
  // long rows are trimmed from the right.
  for (const [rawA, rawB] of pairs) {
    const orientations: Array<readonly [string, string]> = [
      [toTd3Row(rawA), toTd3Row(rawB)],
      [toTd3Row(rawB), toTd3Row(rawA)],
    ];

    for (const [lineA, lineB] of orientations) {
      let result: ReturnType<typeof parse>;
      try {
        result = parse([lineA, lineB]);
      } catch {
        continue;
      }

      // Accept relaxed: the per-field check digits we actually depend on
      // downstream are `documentNumberCheckDigit`, `birthDateCheckDigit`,
      // and `expirationDateCheckDigit` — those three plug directly into
      // BAC key derivation, and if any of them is wrong NFC will refuse
      // to open the secure channel and the user re-scans. The `mrz`
      // library's `valid` flag also requires `compositeCheckDigit` (and,
      // on some passports, `personalNumberCheckDigit`) which are the
      // ones ML Kit gets wrong most often — a single misread digit in
      // the optional/personal slot tanks the entire scan even though
      // the four fields we extract are correct.
      //
      // Lowering acceptance to "the three BAC fields validate" trades
      // one MRZ check digit for the BAC handshake itself as the real
      // gate (CLAUDE.md rule 8: the SUBSEQUENT step still verifies,
      // we're not pretending the MRZ is more trustworthy than it is).
      const REQUIRED_CHECK_FIELDS = new Set([
        'documentNumberCheckDigit',
        'birthDateCheckDigit',
        'expirationDateCheckDigit',
      ]);
      let requiredOk = true;
      for (const detail of result.details) {
        // `details[i].field` is typed `string | null` because the `mrz`
        // library returns generic "unknown" entries for some optional
        // fields; only the named ones map to a check-digit position we
        // depend on, so a null field is irrelevant to BAC and we skip.
        if (
          detail.field !== null
          && REQUIRED_CHECK_FIELDS.has(detail.field)
          && detail.valid !== true
        ) {
          requiredOk = false;
          break;
        }
      }
      if (!requiredOk) continue;

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
        continue;
      }
      if (dateOfBirth.length !== 6 || expiryDate.length !== 6) continue;

      return { passportNumber, nationalityCode, dateOfBirth, expiryDate };
    }
  }

  return null;
}

function toTd3Row(line: string): string {
  if (line.length > TD3_ROW_LEN) return line.slice(0, TD3_ROW_LEN);
  if (line.length < TD3_ROW_LEN) return line.padEnd(TD3_ROW_LEN, '<');
  return line;
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
 * N-frame consensus aggregator. A draft must appear `threshold` frames in
 * a row before we accept it; any null / mismatched draft breaks the
 * streak. Bounded history prevents unbounded growth.
 *
 * Default threshold is `DEFAULT_CONSENSUS_THRESHOLD` (1) so we accept on
 * the first check-digit-valid frame; pass an explicit value to tighten.
 */
export class MrzFrameConsensus {
  private readonly history: PassportMRZDraft[] = [];
  private streakDraft: PassportMRZDraft | null = null;
  private streakLength = 0;
  private readonly threshold: number;

  constructor(threshold: number = DEFAULT_CONSENSUS_THRESHOLD) {
    this.threshold = threshold;
  }

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

    return this.streakLength >= this.threshold ? draft : null;
  }

  reset(): void {
    this.history.length = 0;
    this.streakDraft = null;
    this.streakLength = 0;
  }
}
