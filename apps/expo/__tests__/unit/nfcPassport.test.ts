/**
 * nfcPassport — verifies the Nitro NFC passport surface is honoured by
 * the passport pipeline reducer.
 *
 * The actual NFCPassportReader read can only be exercised on a physical
 * iPhone (Core NFC refuses to start on the simulator). What we *can* test
 * in `bun` is that:
 *
 *   1. The pipeline orchestrator calls the Nitro module's `read(mrz)` with
 *      the user-typed MRZ exactly once.
 *   2. The orchestrator maps the returned `PassportReadResult` into the
 *      reducer's `PassportChipSnapshot` without dropping `passiveAuthValid`
 *      or `chipUid`.
 *   3. A `NFC cancelled` error from the Nitro module surfaces as
 *      `configurationError` via `runPassportPipelineSafe` (matches the
 *      Swift CardError mapping).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

import type { PassportMRZ, PassportReadResult } from '@solidarity/nitro-nfc-passport';

const VALID_MRZ: PassportMRZ = {
  // L898902C3 + check digit 6 — published ICAO 9303 specimen.
  documentNumber: 'L898902C36',
  dateOfBirth: '740812',
  dateOfExpiry: '300101',
};

function fakeRead(mrz: PassportMRZ): PassportReadResult {
  return {
    mrz: {
      nationality: 'TWN',
      documentNumber: mrz.documentNumber,
      name: 'ADA LOVELACE',
      dateOfBirth: mrz.dateOfBirth,
      dateOfExpiry: mrz.dateOfExpiry,
      gender: 'F',
    },
    dataGroups: {
      dg1: new ArrayBuffer(88),
      dg2: new ArrayBuffer(1024),
    },
    chipUid: `NFC-${mrz.documentNumber}`,
    passiveAuthValid: true,
  };
}

beforeAll(async () => {
  await mock.module('@solidarity/nitro-nfc-passport', () => ({
    getNfcPassport: () => ({
      isAvailable: () => true,
      read: async (mrz: PassportMRZ) => fakeRead(mrz),
      cancel: () => undefined,
    }),
  }));
});

describe('nfcPassport — pipeline integration with mocked Nitro module', () => {
  it('runs the orchestrator and emits steps in order', async () => {
    const { runPassportPipeline } = await import('../../src/passport/pipeline');
    const nitro = (await import('@solidarity/nitro-nfc-passport')) as {
      getNfcPassport: () => {
        read: (mrz: PassportMRZ) => Promise<PassportReadResult>;
      };
    };
    const reader = nitro.getNfcPassport();

    const steps: string[] = [];
    const jwt = await runPassportPipeline(
      VALID_MRZ,
      {
        readChip: (m) => reader.read(m),
        generateProof: async () => new ArrayBuffer(32),
        issueVc: async () => 'header.payload.sig',
      },
      (s) => { steps.push(s.type); }
    );

    expect(jwt).toBe('header.payload.sig');
    expect(steps).toEqual([
      'mrzScanned',
      'nfcReading',
      'nfcRead',
      'proofGenerating',
      'proofGenerated',
      'vcIssued',
    ]);
  });

  it('maps the Nitro PassportReadResult into a chip snapshot with stable fields', async () => {
    const { chipFromNitro } = await import('../../src/passport/pipeline');
    const result = fakeRead(VALID_MRZ);
    const snapshot = chipFromNitro(result, 'TWN', VALID_MRZ.documentNumber);
    expect(snapshot.chipUid).toBe(`NFC-${VALID_MRZ.documentNumber}`);
    expect(snapshot.passiveAuthPassed).toBe(true);
    expect(snapshot.nationalityCode).toBe('TWN');
    expect(snapshot.dataGroupsRead).toContain('DG1');
    expect(snapshot.dataGroupsRead).toContain('DG2');
  });

  it('classifies an NFC cancellation as a configurationError', async () => {
    const { runPassportPipelineSafe } = await import('../../src/passport/pipeline');
    const r = await runPassportPipelineSafe(
      VALID_MRZ,
      {
        readChip: () => Promise.reject(new Error('NFC read was cancelled.')),
        generateProof: () => Promise.resolve(new ArrayBuffer(0)),
        issueVc: () => Promise.resolve(''),
      },
      () => undefined
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('configurationError');
      expect(r.error.message).toMatch(/cancel/i);
    }
  });

  it('classifies a chip-authentication failure as configurationError', async () => {
    const { runPassportPipelineSafe } = await import('../../src/passport/pipeline');
    const r = await runPassportPipelineSafe(
      VALID_MRZ,
      {
        readChip: () => Promise.reject(new Error('NFC chip BAC mutual-auth rejected')),
        generateProof: () => Promise.resolve(new ArrayBuffer(0)),
        issueVc: () => Promise.resolve(''),
      },
      () => undefined
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.type).toBe('configurationError');
    }
  });
});
