import { describe, expect, it } from 'bun:test';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const PRODUCT_SECURITY_KEYS = [
  'security.title',
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
  'security.gate.infoTitle',
  'security.gate.info',
  'security.gate.loading',
  'security.rotation.success',
  'security.prompt.issueCredential',
  'security.prompt.presentProof',
  'security.prompt.exportGraph',
  'security.prompt.rotateMasterKey',
  'security.prompt.revealRecoveryBundle',
  'security.prompt.registerTrustAnchor',
  'security.prompt.deleteZKIdentity',
  'security.prompt.deleteCard',
] as const;

describe('product security language', () => {
  it('keeps protocol jargon behind Developer Options', () => {
    const banned = /\b(?:DID|VCs?|ZK|credentials?|graph|trust anchor|master key|key rotation)\b|零知識|憑證|圖譜|信任錨|主金鑰|金鑰輪替/iu;

    for (const key of PRODUCT_SECURITY_KEYS) {
      expect(en[key]).not.toMatch(banned);
      expect(zhHant[key]).not.toMatch(banned);
    }
  });

  it('keeps the full always-asks list behind the ⓘ after the footer was shortened', () => {
    // COPY HONESTY (app/settings/security.tsx): the red line
    // (rotateMasterKey — also gating app-data resets — revealRecoveryBundle,
    // deleteZKIdentity) plus the Pear card release must all still be named.
    for (const phrase of [
      'secure sign-in',
      'erasing app data',
      'private proof data',
      'recovery phrase',
      'card',
    ]) {
      expect(en['security.gate.info']).toContain(phrase);
    }
    for (const phrase of ['更換安全登入', '清除應用程式資料', '刪除私密證明資料', '復原詞組', '名片']) {
      expect(zhHant['security.gate.info']).toContain(phrase);
    }
  });
});
