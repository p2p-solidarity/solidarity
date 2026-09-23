import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Pro paywall', () => {
  it('is reachable from Settings', () => {
    expect(source('../../app/settings/index.tsx')).toContain("router.push('/settings/pro')");
  });

  it('carries every disclosure Apple requires on a subscription paywall', () => {
    const pro = source('../../app/settings/pro.tsx');

    // Purchase + the mandatory restore path.
    expect(pro).toContain('purchaseProYearly');
    expect(pro).toContain('restoreProPurchases');
    expect(pro).toContain("t('pro.restore')");
    // Auto-renew terms, and in-app (not web-only) legal links.
    expect(pro).toContain("t('pro.autoRenew', { price: displayPrice })");
    expect(pro).toContain("router.push('/legal/terms')");
    expect(pro).toContain("router.push('/legal/privacy')");
    // A way for an existing subscriber to manage or cancel.
    expect(pro).toContain('MANAGE_SUBSCRIPTION_URL');

    expect(en['pro.autoRenew']).toContain('{{price}}');
    expect(en['pro.autoRenew']).toMatch(/cancel/iu);
    expect(zhHant['pro.autoRenew']).toContain('{{price}}');
    expect(zhHant['pro.autoRenew']).toContain('取消');
  });

  it('shows the store-localized price, never a hardcoded currency', () => {
    // A Taiwan account is billed in NT$; showing "US$36" there misstates the
    // charge, which Guideline 3.1.2 treats as a rejection.
    const pro = source('../../app/settings/pro.tsx');
    expect(pro).toContain('loadProYearlyProduct');
    expect(pro).toContain('displayPrice');
    expect(pro).not.toMatch(/US\$|NT\$|\$0/u);
    for (const key of ['pro.pricePerYear', 'pro.subscribe', 'pro.autoRenew'] as const) {
      expect(en[key]).not.toMatch(/US\$|\d/u);
      expect(zhHant[key]).not.toMatch(/US\$|NT\$|\d/u);
    }
  });

  it('only advertises Pro features that are actually built', () => {
    const pro = source('../../app/settings/pro.tsx');
    expect(pro).toContain("'pro.feature.sections'");
    expect(pro).toContain("'pro.feature.style'");
    expect(pro).toContain("'pro.feature.footer'");

    // Custom domains need the creds.id license bridge, and Organization has no
    // implementation at all. Selling either before it exists is a rejection and
    // a broken promise — keep them off the paywall until they ship.
    const catalogue = Object.keys(en).filter((key) => key.startsWith('pro.'));
    for (const absent of [
      'pro.feature.domain',
      'pro.feature.dashboard',
      'pro.feature.maintenance',
      'pro.organization',
    ]) {
      expect(catalogue).not.toContain(absent);
    }
    expect(pro).not.toMatch(/creds\.id\/upgrade/u);
  });

  it('keeps the trust features free', () => {
    const pro = source('../../app/settings/pro.tsx');
    expect(pro).toContain('FREE_FEATURE_KEYS');
    expect(pro).toContain("'pro.free.verification'");
    expect(pro).toContain("'pro.free.exchange'");
  });
});

describe('Pro gates read real entitlement', () => {
  it('never hard-locks a Pro control the way the pre-billing placeholder did', () => {
    const sections = source('../../src/components/me/ProfileSectionsList.tsx');
    const appearance = source('../../src/components/me/PageAppearanceSheet.tsx');

    for (const file of [sections, appearance]) {
      expect(file).toContain('useProGate');
    }
    // The old surface gated on the static catalogue flag alone, so even a
    // paying user stayed locked out. Every gate must now consult entitlement.
    expect(sections).toContain('proLocked');
    expect(sections).not.toMatch(/disabled=\{catalog\.pro\}/u);
    expect(appearance).toContain('proLocked');
    expect(appearance).not.toMatch(/onValueChange=\{openProSettings\}/u);
  });

  it('gates controls without ever rewriting the design a lapse leaves behind', () => {
    // Downgrade must never delete blocks or reset appearance: the gate helper
    // exposes navigation and a predicate, and nothing else.
    const gate = source('../../src/pro/useProGate.ts');
    expect(gate).toContain('locked');
    expect(gate).not.toMatch(/removeBlock|setAppearance|resetFor/u);
  });
});
