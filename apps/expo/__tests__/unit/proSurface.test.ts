import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('simple Pro surface', () => {
  it('is reachable from Settings and opens the real browser management URL', () => {
    const settings = source('../../app/settings/index.tsx');
    const pro = source('../../app/settings/pro.tsx');

    expect(settings).toContain("router.push('/settings/pro')");
    expect(pro).toContain("const PRO_MANAGEMENT_URL = 'https://creds.id/upgrade'");
    expect(pro).toContain('WebBrowser.openBrowserAsync(PRO_MANAGEMENT_URL)');
    expect(pro).toContain("t('pro.browserError')");
    expect(pro).not.toMatch(/setIsPro|setPro|restorePurchase|fake|mock/iu);
  });

  it('keeps trust features free and lists the five v2 Pro benefits', () => {
    const pro = source('../../app/settings/pro.tsx');

    expect(pro).toContain('FREE_FEATURE_KEYS');
    expect(pro).toContain('PRO_FEATURE_KEYS');
    expect(pro).toContain("'pro.free.verification'");
    expect(pro).toContain("'pro.feature.domain'");
    expect(pro).toContain("'pro.feature.maintenance'");
    expect(pro).toContain("'pro.feature.leaveCard'");
    expect(pro).toContain("'pro.feature.control'");
    expect(pro).toContain("'pro.feature.dashboard'");
    expect(en['pro.price']).toBe('US$36 a year');
    expect(zhHant['pro.price']).toBe('US$36 / 年');
  });
});
