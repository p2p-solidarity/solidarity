import { describe, expect, it } from 'bun:test';

import {
  passportShowVerifierResult,
  type PassportShowResultTranslator,
} from '../../src/scan/passportShowResult';
import type { PassportShowScanResult } from '../../src/scan/showPresentationHandler';

const t: PassportShowResultTranslator = (key, options) => {
  if (key === 'passportShow.ageYes') return `Age over ${String(options?.['threshold'])}: yes`;
  if (key === 'passportShow.nationality') return `Nationality: ${String(options?.['code'])}`;
  if (key === 'passportShow.resultValid') return 'ZK presentation valid';
  if (key === 'passportShow.resultValidTimeBucket') {
    return 'ZK presentation valid (time-window mode)';
  }
  if (key === 'passportShow.resultInvalid') return 'Presentation rejected';
  return key;
};

describe('passport show scan result mapping', () => {
  it('does not display holderDid as a verified result detail', () => {
    const result: PassportShowScanResult = {
      ok: true,
      freshnessMode: 'challenge',
      envelope: {
        schema: 'gg.solidarity.passport.show-presentation.v1',
        proofType: 'passport_show_v1',
        passportNoirVersion: 'test',
        circuit: 'openac_show',
        proofB64: 'proof',
        vkB64: 'vk',
        publicInputs: {
          nonceHashB64: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          linkScope: '1',
          linkMode: false,
          epoch: '1',
          today: { year: 2026, month: 6, day: 12 },
          ageThreshold: 18,
          discloseAge: true,
          discloseNationality: true,
          commitmentX: '1',
          commitmentY: '2',
          linkTag: '3',
          outIsOlder: true,
          outNationality: 'TWN',
        },
        freshness: 'challenge',
        holderDid: 'did:key:attacker-controlled',
        selectedClaims: ['age_over_18', 'nationality'],
      },
      disclosed: {
        age: { threshold: 18, satisfied: true },
        nationality: 'TWN',
      },
    };

    const mapped = passportShowVerifierResult(result, t);
    expect(mapped.valid).toBe(true);
    expect(mapped.details).toEqual(['Age over 18: yes', 'Nationality: TWN']);
  });
});
