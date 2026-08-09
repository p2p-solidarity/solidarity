import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('S5 onboarding and Bluesky UI wiring', () => {
  it('uses the same headless Bluesky flow, confirms replacement, and renders the real verifier state', () => {
    const route = source('../../app/verify/bluesky.tsx');

    expect(route).toContain('beginBlueskyConnect');
    expect(route).toContain('confirmBlueskyReplacement');
    expect(route).toContain('confirmDialog');
    expect(route).toContain('BindingBadgeChip');
    expect(route).toContain('inlineSuffix=');
    expect(route).toContain('shouldAutoRepublish(isAlreadyPublished, autoRepublishEnabled)');
    expect(route).toContain('publishWithNostrAutoSetup');
    expect(route).not.toContain('Alert.alert');
    expect(route).not.toMatch(/\bfetch\s*\(/u);
    expect(en['blueskyConnect.handlePlaceholder']).toBe('alice');
    expect(zhHant['blueskyConnect.handlePlaceholder']).toBe('alice');
    expect(en['blueskyConnect.autoRepublishFailed']).toContain('Republish it from Settings');
    expect(zhHant['blueskyConnect.autoRepublishFailed']).toContain('請從設定重新發布');
  });

  it('keeps verification on Page instead of adding a technical onboarding step', () => {
    const flow = source('../../app/onboarding/index.tsx');
    const ready = source('../../src/onboarding/steps/ReadyStep.tsx');
    const pageRoute = source('../../app/(tabs)/me/index.tsx');

    expect(flow).not.toContain("case 'connect'");
    expect(flow).not.toContain("router.replace('/verify/bluesky')");
    expect(flow).toContain('pathname: PRIMARY_TAB_HREFS.page');
    expect(flow).toContain("addProof: '1'");
    expect(pageRoute).toContain("params.addProof === '1'");
    expect(pageRoute).toContain("router.setParams({ addProof: '0' })");
    expect(pageRoute).toContain('openAddProof()');
    expect(pageRoute).toContain("router.push('/passport')");
    expect(pageRoute).not.toContain("router.push('/verify/nostr')");
    expect(`${flow}\n${ready}`).not.toMatch(/<Pressable(?:\s|>)/u);
  });

  it('uses the self-owned Share copy in both locales', () => {
    expect(en['shareStep.subtitle']).toBe(
      'You hold this page. Print it or put it in your bio — it can be verified without us.'
    );
    expect(zhHant['shareStep.subtitle']).toBe(
      '這一頁由你持有。印出來、貼進 bio — 沒有我們，它也能被驗證。'
    );
  });
});
