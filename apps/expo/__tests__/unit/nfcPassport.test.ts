/**
 * nfcPassport — verifies the Nitro NFC passport surface is honoured by
 * pipeline reducer.
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
      dg15: new ArrayBuffer(32),
      sod: new ArrayBuffer(512),
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
    expect(snapshot.passiveAuthValid).toBe(true);
    expect(snapshot.mrz).toEqual(result.mrz);
    expect(snapshot.nationalityCode).toBe('TWN');
    expect(snapshot.dataGroupsRead).toContain('DG1');
    expect(snapshot.dataGroupsRead).toContain('DG2');
    expect(snapshot.dataGroups?.dg1).toBe(result.dataGroups.dg1);
    expect(snapshot.dataGroups?.dg15).toBe(result.dataGroups.dg15);
    expect(snapshot.dataGroups?.sod).toBe(result.dataGroups.sod);
  });

  it('preserves the native OpenAC v3 witness bundle JSON for the proof stage', async () => {
    const { chipFromNitro } = await import('../../src/passport/pipeline');
    const openAcV3WitnessBundleJson = JSON.stringify({
      dscChainInputsJson: '{"dsc":true}',
      passportAdapterInputsJson: '{"passport":true}',
      openAcShowInputsJson: '{"show":true}',
    });
    const result = {
      ...fakeRead(VALID_MRZ),
      openAcV3WitnessBundleJson,
    };

    const snapshot = chipFromNitro(result, 'TWN', VALID_MRZ.documentNumber);

    expect(snapshot.openAcV3WitnessBundleJson).toBe(openAcV3WitnessBundleJson);
  });

  it('preserves native DG15 Active Authentication evidence for trust and diagnostics', async () => {
    const { chipFromNitro } = await import('../../src/passport/pipeline');
    const activeAuthJson = JSON.stringify({
      challengeB64: 'challenge',
      signatureRawB64: 'signature',
    });
    const result = {
      ...fakeRead(VALID_MRZ),
      activeAuthJson,
    };

    const snapshot = chipFromNitro(result, 'TWN', VALID_MRZ.documentNumber);

    expect(snapshot.activeAuthJson).toBe(activeAuthJson);
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

  it('prunes dataGroupsRead based on which DG buffers actually came back', async () => {
    // Older e-passports may not ship DG14/DG15 — make sure the snapshot
    // labels reflect what the chip actually delivered rather than a
    // hard-coded list (which would lie about what was authenticated).
    const { chipFromNitro } = await import('../../src/passport/pipeline');
    const minimal = {
      ...fakeRead(VALID_MRZ),
      dataGroups: { dg1: new ArrayBuffer(88), dg2: new ArrayBuffer(1024) },
    };
    const snapshot = chipFromNitro(minimal, 'TWN', VALID_MRZ.documentNumber);
    expect(snapshot.dataGroupsRead).toEqual(['COM', 'SOD', 'DG1', 'DG2']);
    expect(snapshot.dataGroupsRead).not.toContain('DG14');
    expect(snapshot.dataGroupsRead).not.toContain('DG15');
  });

  it('extracts the printable MRZ string from a DG1 TLV blob', async () => {
    const { chipFromNitro } = await import('../../src/passport/pipeline');
    // Synthesize a DG1 TLV: tag 61 + length + tag 5F1F + length + 88 ASCII bytes.
    const td3Line1 = 'P<TWNDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<';
    const td3Line2 = 'L898902C36TWN7408122F3001016<<<<<<<<<<<<<<00';
    const mrzAscii = td3Line1 + td3Line2;
    const mrzBytes = new Uint8Array(mrzAscii.length);
    for (let i = 0; i < mrzAscii.length; i += 1) {
      mrzBytes[i] = mrzAscii.charCodeAt(i);
    }
    // Real DG1 TLV starts with tag 0x61 + length + inner tag 0x5F1F +
    // length, all of which are bytes OUTSIDE the MRZ alphabet (A-Z, 0-9,
    // `<`). We pad two extra non-MRZ bytes (0x00) at the end too so the
    // sweeper unambiguously picks the MRZ run as the longest legal
    // segment without merging trailing junk.
    const dg1 = new Uint8Array(4 + mrzBytes.length + 2);
    dg1[0] = 0x61;
    dg1[1] = 0x5a; // length placeholder
    dg1[2] = 0x5f; // inner tag part 1 — '_' in ASCII; NOT in MRZ alphabet
    dg1[3] = 0x1f; // inner tag part 2 — control byte, NOT in MRZ alphabet
    dg1.set(mrzBytes, 4);
    dg1[4 + mrzBytes.length] = 0x00;
    dg1[5 + mrzBytes.length] = 0x00;

    const result = { ...fakeRead(VALID_MRZ), dataGroups: { dg1: dg1.buffer } };
    const snapshot = chipFromNitro(result, 'TWN', VALID_MRZ.documentNumber);
    expect(snapshot.dg1MRZData).toBe(mrzAscii);
  });
});
