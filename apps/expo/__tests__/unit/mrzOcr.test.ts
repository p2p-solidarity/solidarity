/**
 * mrzOcr — parser + N-frame consensus.
 *
 * Coverage:
 *   - real TD3 specimen → expected draft.
 *   - random English text → null.
 *   - one corrupted check digit → null.
 *   - MrzFrameConsensus state-machine matrix.
 */
import { describe, expect, it } from 'bun:test';

import {
  MrzFrameConsensus,
  parseMrzLines,
} from '../../src/passport/mrzOcr';

// A real-world ICAO 9303 TD3 specimen (Germany, "MUSTERMANN/ERIKA").
// Used as the canonical example in the `mrz` package's README and across
// the BSI sample-document set. All check digits + state codes valid.
const SPECIMEN_LINE_A = 'P<D<<MUSTERMANN<<ERIKA<<<<<<<<<<<<<<<<<<<<<<';
const SPECIMEN_LINE_B = 'C01X00T478D<<6408125F2702283<<<<<<<<<<<<<<<4';

describe('parseMrzLines', () => {
  it('parses a valid ICAO 9303 TD3 specimen', () => {
    const draft = parseMrzLines([SPECIMEN_LINE_A, SPECIMEN_LINE_B]);
    expect(draft).toEqual({
      passportNumber: 'C01X00T47',
      nationalityCode: 'D',
      dateOfBirth: '640812',
      expiryDate: '270228',
    });
  });

  it('parses even when surrounded by noise lines from OCR', () => {
    const draft = parseMrzLines([
      'PASSPORT',
      'Federal Republic of Germany',
      SPECIMEN_LINE_A,
      SPECIMEN_LINE_B,
      'Signature',
    ]);
    expect(draft?.passportNumber).toBe('C01X00T47');
  });

  it('returns null for random English text', () => {
    expect(
      parseMrzLines([
        'The quick brown fox jumps over the lazy dog',
        'Hello world this is not an MRZ at all',
        'Another perfectly normal sentence here',
      ]),
    ).toBeNull();
  });

  it('returns null when fewer than two MRZ-shaped lines are present', () => {
    expect(parseMrzLines([SPECIMEN_LINE_A])).toBeNull();
    expect(parseMrzLines([])).toBeNull();
  });

  it('returns null when a check digit is wrong', () => {
    // Flip the document-number check digit from 8 → 9 (position 9).
    const corrupted =
      SPECIMEN_LINE_B.slice(0, 9) + '9' + SPECIMEN_LINE_B.slice(10);
    expect(parseMrzLines([SPECIMEN_LINE_A, corrupted])).toBeNull();
  });

  it('returns null when the birth-date check digit is wrong', () => {
    // birth-date check digit lives at index 19 (was '5').
    const corrupted =
      SPECIMEN_LINE_B.slice(0, 19) + '0' + SPECIMEN_LINE_B.slice(20);
    expect(parseMrzLines([SPECIMEN_LINE_A, corrupted])).toBeNull();
  });
});

describe('MrzFrameConsensus', () => {
  const DRAFT_A = {
    passportNumber: 'C01X00T47',
    nationalityCode: 'D',
    dateOfBirth: '640812',
    expiryDate: '270228',
  };
  const DRAFT_B = {
    passportNumber: 'L898902C3',
    nationalityCode: 'UTO',
    dateOfBirth: '740812',
    expiryDate: '120415',
  };

  it('returns the draft once it has appeared three times in a row', () => {
    const c = new MrzFrameConsensus(3);
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toEqual(DRAFT_A);
  });

  it('does not return after two identical + one mismatched draft', () => {
    const c = new MrzFrameConsensus(3);
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_B)).toBeNull();
  });

  it('resets the streak when a null frame arrives', () => {
    const c = new MrzFrameConsensus(3);
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(null)).toBeNull();
    expect(c.ingest(DRAFT_A)).toBeNull();
    // Only two in a row again — still not accepted.
  });

  it('recovers after three different drafts followed by three identical', () => {
    const c = new MrzFrameConsensus(3);
    c.ingest(DRAFT_A);
    c.ingest(DRAFT_B);
    c.ingest(DRAFT_A);
    // Streak is now (DRAFT_A, 1). Next two identical lock it in.
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toEqual(DRAFT_A);
  });

  it('reset() clears the state machine', () => {
    const c = new MrzFrameConsensus(3);
    c.ingest(DRAFT_A);
    c.ingest(DRAFT_A);
    c.reset();
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toBeNull();
    expect(c.ingest(DRAFT_A)).toEqual(DRAFT_A);
  });

  it('default threshold is 1 — single check-digit-valid frame accepts', () => {
    const c = new MrzFrameConsensus();
    expect(c.ingest(DRAFT_A)).toEqual(DRAFT_A);
  });

  it('default threshold still treats null as a streak break', () => {
    const c = new MrzFrameConsensus();
    expect(c.ingest(null)).toBeNull();
    expect(c.ingest(DRAFT_A)).toEqual(DRAFT_A);
  });
});
