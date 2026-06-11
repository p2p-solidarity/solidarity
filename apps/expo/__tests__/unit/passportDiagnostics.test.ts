import { describe, expect, it } from 'bun:test';

import {
  buildPassportErrorDetail,
  classifyPassportProofError,
  friendlyProofError,
} from '../../src/passport/diagnostics';

function bytes(length: number): ArrayBuffer {
  return new ArrayBuffer(length);
}

const INVALID_AA_KEY_ERROR =
  "Proof generation failed: Failed to solve program: 'Failed to solve blackbox function: ecdsa_secp256k1, reason: Invalid public key provided for ECDSA verification'";

describe('passport diagnostics', () => {
  it('maps the invalid AA public key prover failure to a user-safe summary', () => {
    expect(classifyPassportProofError(INVALID_AA_KEY_ERROR)).toBe(
      'PASSPORT_AA_INVALID_PUBLIC_KEY'
    );
    expect(friendlyProofError(INVALID_AA_KEY_ERROR)).toBe(
      'Passport proof failed while checking Active Authentication.'
    );
  });

  it('maps missing DG15/AA proof gates to an actionable summary', () => {
    expect(classifyPassportProofError('OpenAC v3 missing DG15.')).toBe(
      'PASSPORT_AA_MISSING_INPUTS'
    );
    expect(
      classifyPassportProofError('OpenAC v3 missing Active Authentication evidence.')
    ).toBe('PASSPORT_AA_MISSING_INPUTS');
    expect(
      classifyPassportProofError(
        'OpenAC v3 witness unavailable: missing-active-auth-witness'
      )
    ).toBe('PASSPORT_AA_MISSING_INPUTS');
    expect(
      classifyPassportProofError('OpenAC v3 witness unavailable: missing-dg15')
    ).toBe('PASSPORT_AA_MISSING_INPUTS');
    expect(friendlyProofError('OpenAC v3 missing DG15.')).toBe(
      'Passport chip did not provide DG15 Active Authentication data.'
    );
  });

  it('shows when DG15 and Active Authentication evidence are missing', () => {
    const detail = buildPassportErrorDetail({
      phase: 'proof-generation',
      error: INVALID_AA_KEY_ERROR,
      chip: {
        dataGroups: {
          dg1: bytes(88),
          sod: bytes(512),
        },
        dataGroupsRead: ['COM', 'SOD', 'DG1'],
        passiveAuthPassed: true,
        isSimulated: false,
      },
    });

    expect(detail).toContain('DG15: missing');
    expect(detail).toContain('Active Authentication evidence: missing');
    expect(detail).toContain('OpenAC v3 witness: missing');
    expect(detail).toContain('Likely cause: DG15 was not returned by the NFC reader.');
    expect(detail).toContain('Invalid public key provided for ECDSA verification');
  });

  it('keeps DG15/AA present distinct from a missing-reader-data case', () => {
    const activeAuthJson = JSON.stringify({
      challengeB64: 'challenge',
      signatureRawB64: 'signature',
    });
    const detail = buildPassportErrorDetail({
      phase: 'proof-generation',
      error: INVALID_AA_KEY_ERROR,
      chip: {
        dataGroups: {
          dg1: bytes(88),
          dg15: bytes(94),
          sod: bytes(512),
        },
        dataGroupsRead: ['COM', 'SOD', 'DG1', 'DG15'],
        activeAuthJson,
        openAcV3WitnessBundleJson: '{"dscChainInputsJson":"{}","passportAdapterInputsJson":"{}","openAcShowInputsJson":"{}"}',
        passiveAuthPassed: true,
        isSimulated: false,
      },
    });

    expect(detail).toContain('DG15: present (94 bytes)');
    expect(detail).toContain('Active Authentication evidence: present');
    expect(detail).toContain('OpenAC v3 witness: present');
    expect(detail).toContain('Likely cause: DG15 and AA were present; inspect passport-noir witness/circuit inputs.');
  });
});
