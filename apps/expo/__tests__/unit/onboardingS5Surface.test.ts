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
    expect(route).not.toContain('Alert.alert');
    expect(route).not.toMatch(/\bfetch\s*\(/u);
    expect(en['blueskyConnect.handlePlaceholder']).toBe('alice');
    expect(zhHant['blueskyConnect.handlePlaceholder']).toBe('alice');
  });

  it('keeps one default publish route and carries verifier evidence into completion', () => {
    const connect = source('../../src/onboarding/steps/ConnectStep.tsx');
    const scaffold = source('../../src/onboarding/steps/OnboardingScaffold.tsx');
    const flow = source('../../app/onboarding/index.tsx');
    const complete = source('../../src/onboarding/steps/CompleteStep.tsx');
    const meRows = source('../../src/components/me/IdentityCredentialRows.tsx');

    expect(connect).toContain("router.push('/verify/nostr')");
    expect(connect).not.toContain("router.push('/verify/bluesky')");
    expect(connect).toContain('useOnboardingBadgeVerification');
    expect(flow).toContain("case 'connect'");
    expect(flow).toContain("goTo('connect')");
    expect(flow).toContain('setBadgeResult');
    expect(complete).toContain('useOnboardingBadgeVerification');
    expect(complete).toContain('badgeResult');
    expect(complete).toContain('duration: 300');
    expect(complete).toContain('scale.value = 0.95');
    expect(complete).toContain('useReducedMotion');
    expect(meRows).toContain("router.push('/verify/bluesky')");
    expect(meRows).toContain('onOpenBindings');
    expect(`${flow}\n${connect}\n${scaffold}`).not.toMatch(/<Pressable(?:\s|>)/u);
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
