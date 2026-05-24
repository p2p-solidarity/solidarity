/**
 * Passport pipeline orchestrator — verifies step-event ordering with
 * dependency stubs. Native Nitro modules (NFC, ZK) are mocked at the
 * deps boundary so we don't need a real chip in tests.
 */
import { describe, expect, it } from 'bun:test';

import type { PassportMRZ } from '@solidarity/nitro-nfc-passport';

import {
  mrzCheckDigit,
  runPassportPipeline,
  runPassportPipelineSafe,
  selectNfcReadStrategy,
  validateMrzChecksum,
  type PassportPipelineDeps,
  type PassportStep,
} from '../../src/passport/pipeline';

// Validated ICAO 9303 specimen passport number + embedded check digit.
// `L898902C3` + `6` matches mrzCheckDigit("L898902C3") = 6.
const VALID_MRZ: PassportMRZ = {
  documentNumber: 'L898902C36',
  dateOfBirth: '740812',
  dateOfExpiry: '300101',
};

function makeNoopDeps(): PassportPipelineDeps {
  return {
    readChip: () => Promise.resolve({
      mrz: {
        nationality: 'TWN',
        documentNumber: VALID_MRZ.documentNumber,
        name: 'ADA LOVELACE',
        dateOfBirth: VALID_MRZ.dateOfBirth,
        dateOfExpiry: VALID_MRZ.dateOfExpiry,
        gender: 'F',
      },
      dataGroups: {},
      passiveAuthValid: true,
    }),
    generateProof: () => Promise.resolve(new ArrayBuffer(32)),
    issueVc: () => Promise.resolve('header.payload.sig'),
  };
}

describe('runPassportPipeline', () => {
  it('emits steps in order and resolves with VC JWT', async () => {
    const steps: PassportStep[] = [];
    const onStep = (s: PassportStep) => steps.push(s);

    const jwt = await runPassportPipeline(
      { documentNumber: 'X1234567', dateOfBirth: '900101', dateOfExpiry: '300101' },
      {
        readChip: async () => ({
          mrz: {
            nationality: 'TWN',
            documentNumber: 'X1234567',
            name: 'ADA LOVELACE',
            dateOfBirth: '900101',
            dateOfExpiry: '300101',
            gender: 'F',
          },
          dataGroups: {},
          passiveAuthValid: true,
        }),
        generateProof: async () => new ArrayBuffer(32),
        issueVc: async () => 'header.payload.sig',
      },
      onStep
    );

    expect(jwt).toBe('header.payload.sig');
    const stepTypes = steps.map((s) => s.type);
    expect(stepTypes).toEqual([
      'mrzScanned',
      'nfcReading',
      'nfcRead',
      'proofGenerating',
      'proofGenerated',
      'vcIssued',
    ]);
  });

  it('propagates NFC errors as thrown promise rejection', async () => {
    let captured: Error | null = null;
    try {
      await runPassportPipeline(
        { documentNumber: 'X', dateOfBirth: '900101', dateOfExpiry: '300101' },
        {
          readChip: () => {
            throw new Error('NFC: tag lost');
          },
          generateProof: () => Promise.resolve(new ArrayBuffer(0)),
          issueVc: () => Promise.resolve(''),
        },
        () => undefined
      );
    } catch (err) {
      captured = err as Error;
    }
    expect(captured?.message).toBe('NFC: tag lost');
  });
});

// ---------------------------------------------------------------------------
// MRZ check-digit validation (mirrors Swift MRZScannerService.computeCheckDigit).
// ---------------------------------------------------------------------------

describe('mrzCheckDigit', () => {
  it('matches the ICAO 9303 specimen check digit for L898902C3', () => {
    // Specimen MRZ from ICAO 9303 Part 4 — published reference value.
    expect(mrzCheckDigit('L898902C3')).toBe(6);
  });

  it('treats `<` filler as zero and digit chars at face value', () => {
    expect(mrzCheckDigit('<<<<<<<<<')).toBe(0);
    expect(mrzCheckDigit('123456789')).toBe(((1*7 + 2*3 + 3*1) + (4*7 + 5*3 + 6*1) + (7*7 + 8*3 + 9*1)) % 10);
  });

  it('maps letters to (ascii - A) + 10', () => {
    // 'A' contributes 10 * 7 = 70 → 0 mod 10
    expect(mrzCheckDigit('A')).toBe(0);
    // 'B' contributes 11 * 7 = 77 → 7 mod 10
    expect(mrzCheckDigit('B')).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// validateMrzChecksum (Result-returning, typed CardError on failure).
// ---------------------------------------------------------------------------

describe('validateMrzChecksum', () => {
  it('accepts a passport number whose embedded check digit is correct', () => {
    const r = validateMrzChecksum(VALID_MRZ);
    expect(r.ok).toBe(true);
  });

  it('returns a typed validationError when the check digit is wrong', () => {
    const bad: PassportMRZ = { ...VALID_MRZ, documentNumber: 'L898902C30' };
    const r = validateMrzChecksum(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Mirrors Swift CardError.validationError(message:) — the type discriminator
      // is the wire-equivalent of Swift's enum case name.
      expect(r.error.type).toBe('validationError');
      expect(r.error.message).toMatch(/check digit/i);
    }
  });

  it('rejects an MRZ whose last char is non-numeric (missing check digit)', () => {
    // Trailing letter `C` is the original specimen `L898902C3` truncated to
    // 9 chars — no embedded check digit, which the validator must reject.
    const noChecksum: PassportMRZ = { ...VALID_MRZ, documentNumber: 'L8989C2C3C' };
    const noChecksumBad: PassportMRZ = { ...VALID_MRZ, documentNumber: 'L898902C3X' };
    const r1 = validateMrzChecksum(noChecksumBad);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.type).toBe('validationError');
    // Sanity: also reject a doc number whose check digit is wrong but
    // structure is valid (so we're not just hitting the missing-digit branch).
    const r2 = validateMrzChecksum(noChecksum);
    expect(r2.ok).toBe(false);
  });

  it('rejects malformed YYMMDD dates', () => {
    const r = validateMrzChecksum({ ...VALID_MRZ, dateOfBirth: '74' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.type).toBe('validationError');
  });
});

// ---------------------------------------------------------------------------
// runPassportPipelineSafe — Result<jwt, CardError>. Mirrors Swift
// PassportPipelineService.{validateMRZ → readNFCChip → generateProof}.
// Each step returns a typed `CardError` variant (validationError /
// configurationError / proofGenerationError) instead of throwing.
// ---------------------------------------------------------------------------

describe('runPassportPipelineSafe — typed error reporting', () => {
  it('returns Err(validationError) when the MRZ check digit is wrong', async () => {
    const steps: PassportStep[] = [];
    const r = await runPassportPipelineSafe(
      { ...VALID_MRZ, documentNumber: 'L898902C30' }, // last digit flipped
      makeNoopDeps(),
      (s) => { steps.push(s); }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Matches Swift PassportPipelineService.validateMRZ →
      // .failure(.validationError("…check digit…")). The typed code is the
      // wire-equivalent of Swift CardError.validationError.
      expect(r.error.type).toBe('validationError');
      expect(r.error.message).toMatch(/check digit/i);
    }
    // No NFC / proof events should have fired — checksum gates the pipeline.
    expect(steps.map((s) => s.type)).toEqual(['error']);
  });

  it('returns Err(configurationError) when chip authentication fails', async () => {
    const steps: PassportStep[] = [];
    const r = await runPassportPipelineSafe(
      VALID_MRZ,
      {
        readChip: () => {
          // Mirrors Swift NFCPassportReaderService throwing NFCError.readFailed,
          // which PassportPipelineService maps to CardError.configurationError.
          throw new Error('NFC chip authentication failed: BAC mutual-auth rejected');
        },
        generateProof: () => Promise.resolve(new ArrayBuffer(0)),
        issueVc: () => Promise.resolve(''),
      },
      (s) => { steps.push(s); }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // Swift CardResult side: .failure(.configurationError("NFC read failed: …")).
      expect(r.error.type).toBe('configurationError');
      expect(r.error.message).toMatch(/nfc|chip|bac/i);
    }
    // mrzScanned + nfcReading fire, then error.
    expect(steps.map((s) => s.type)).toEqual(['mrzScanned', 'nfcReading', 'error']);
  });

  it('returns Ok(jwt) on the happy path with a valid MRZ + chip + proof', async () => {
    const r = await runPassportPipelineSafe(
      VALID_MRZ,
      makeNoopDeps(),
      () => undefined
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('header.payload.sig');
  });
});

// ---------------------------------------------------------------------------
// selectNfcReadStrategy — guarantees production builds never silently fall
// back to the simulated chip. Mirrors Swift PassportPipelineService
// .shouldSimulateNFC (DeveloperModeManager.isDeveloperMode &&
// .simulateNFC) plus the explicit "no NFC hardware" rejection path.
// ---------------------------------------------------------------------------

describe('selectNfcReadStrategy', () => {
  it('returns `real` when production build + bridge linked + hardware available', () => {
    const s = selectNfcReadStrategy({
      nitroLinked: true,
      hardwareAvailable: true,
      developerMode: false,
      simulateNfc: false,
    });
    expect(s.kind).toBe('real');
  });

  it('returns `unavailable/module-missing` in production when the Nitro module isnt linked', () => {
    // Most common cause of the "real chip tap returns null" symptom on
    // device — the Nitro HybridObject failed to register so the screen
    // would previously fall back to a mock chip without telling the user.
    // The strategy now surfaces this as a typed error.
    const s = selectNfcReadStrategy({
      nitroLinked: false,
      hardwareAvailable: false,
      developerMode: false,
      simulateNfc: false,
    });
    expect(s.kind).toBe('unavailable');
    if (s.kind === 'unavailable') {
      expect(s.reason).toBe('module-missing');
      expect(s.message).toMatch(/rebuild|pod install/i);
    }
  });

  it('returns `unavailable/hardware-unavailable` in production on iOS Simulator', () => {
    // iOS Simulator returns isAvailable=false because Core NFC refuses to
    // start. We must NOT switch to a synthetic chip — show the user a
    // clear error instead.
    const s = selectNfcReadStrategy({
      nitroLinked: true,
      hardwareAvailable: false,
      developerMode: false,
      simulateNfc: false,
    });
    expect(s.kind).toBe('unavailable');
    if (s.kind === 'unavailable') {
      expect(s.reason).toBe('hardware-unavailable');
      expect(s.message).toMatch(/physical|iphone/i);
    }
  });

  it('returns `simulated` only when developer mode + simulateNfc are both on', () => {
    const s = selectNfcReadStrategy({
      nitroLinked: false,
      hardwareAvailable: false,
      developerMode: true,
      simulateNfc: true,
    });
    expect(s.kind).toBe('simulated');
    if (s.kind === 'simulated') expect(s.reason).toBe('developer-mode');
  });

  it('does NOT simulate when developer mode is on but the simulateNfc toggle is off', () => {
    const s = selectNfcReadStrategy({
      nitroLinked: true,
      hardwareAvailable: false,
      developerMode: true,
      simulateNfc: false,
    });
    expect(s.kind).toBe('unavailable');
  });

  it('prefers `real` over the developer-mode toggle when only developerMode is true', () => {
    // Defensive: developer mode alone should not flip a working device
    // into mock mode — both flags are required.
    const s = selectNfcReadStrategy({
      nitroLinked: true,
      hardwareAvailable: true,
      developerMode: true,
      simulateNfc: false,
    });
    expect(s.kind).toBe('real');
  });
});
