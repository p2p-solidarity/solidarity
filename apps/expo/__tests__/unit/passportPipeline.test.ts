/**
 * Passport pipeline orchestrator — verifies step-event ordering with
 * dependency stubs. Native Nitro modules (NFC, ZK) are mocked at the
 * deps boundary so we don't need a real chip in tests.
 */
import { describe, expect, it } from 'bun:test';

import { runPassportPipeline, type PassportStep } from '../../src/passport/pipeline';

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
    await expect(
      runPassportPipeline(
        { documentNumber: 'X', dateOfBirth: '900101', dateOfExpiry: '300101' },
        {
          readChip: async () => {
            throw new Error('NFC: tag lost');
          },
          generateProof: async () => new ArrayBuffer(0),
          issueVc: async () => '',
        },
        () => undefined
      )
    ).rejects.toThrow('NFC: tag lost');
  });
});
