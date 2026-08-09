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
    const meRows = source('../../src/components/me/IdentityCredentialRows.tsx');

    expect(flow).not.toContain("case 'connect'");
    expect(flow).toContain("router.replace('/verify/bluesky')");
    expect(meRows).toContain("router.push('/verify/bluesky')");
    expect(meRows).toContain('onOpenBindings');
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
