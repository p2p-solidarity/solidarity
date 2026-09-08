import { describe, expect, it } from 'bun:test';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const PRODUCT_SECURITY_KEYS = [
  'security.title',
  'security.subtitle',
  'security.section.keyRotation',
  'security.section.keyRotationFooter',
  'security.action.rotateMasterKeyTitle',
  'security.section.protection',
  'security.mode.everyTime.title',
  'security.mode.everyTime.subtitle',
  'security.mode.balanced.title',
  'security.mode.balanced.subtitle',
  'security.mode.redLineOnly.title',
  'security.mode.redLineOnly.subtitle',
  'security.gate.footer',
  'security.gate.loading',
  'security.rotation.success',
  'security.prompt.issueCredential',
  'security.prompt.presentProof',
  'security.prompt.exportGraph',
  'security.prompt.rotateMasterKey',
  'security.prompt.revealRecoveryBundle',
  'security.prompt.registerTrustAnchor',
  'security.prompt.deleteZKIdentity',
] as const;

describe('product security language', () => {
  it('keeps protocol jargon behind Developer Options', () => {
    const banned = /\b(?:DID|VCs?|ZK|credentials?|graph|trust anchor|master key|key rotation)\b|零知識|憑證|圖譜|信任錨|主金鑰|金鑰輪替/iu;

    for (const key of PRODUCT_SECURITY_KEYS) {
      expect(en[key]).not.toMatch(banned);
      expect(zhHant[key]).not.toMatch(banned);
    }
  });
});
