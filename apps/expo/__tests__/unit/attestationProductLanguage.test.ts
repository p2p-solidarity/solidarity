import { describe, expect, it } from 'bun:test';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const PRODUCT_ATTESTATION_KEYS = [
  'credentialDetail.disclosuresHeader',
  'credentialDetail.levelL1',
  'credentialDetail.levelL2',
  'credentialDetail.levelL3',
  'credentialDetail.levelL3Plus',
  'passportShow.inlineHint',
  'passportShow.resultValid',
  'passportShow.resultValidTimeBucket',
  'shareSettings.legend.notInVc',
  'shareSettings.vcLegendHint',
] as const;

describe('product attestation language', () => {
  it('describes trust and included details without protocol abbreviations', () => {
    const banned = /\b(?:VC|ZK|AA|selective disclosures?)\b|選擇性揭露/iu;

    for (const key of PRODUCT_ATTESTATION_KEYS) {
      expect(en[key]).not.toMatch(banned);
      expect(zhHant[key]).not.toMatch(banned);
    }
  });
});
