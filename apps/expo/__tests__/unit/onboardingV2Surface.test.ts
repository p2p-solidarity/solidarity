import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';
import {
  normalizePublicPageUsernameInput,
  publicPagePath,
  validatePublicPageUsername,
} from '../../src/onboarding/publicPageUsername';

const source = (path: string): string =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('v2 onboarding contract', () => {
  it('uses five progress dots and the exact product step components', () => {
    const flow = source('../../app/onboarding/index.tsx');
    const scaffold = source('../../src/onboarding/steps/V2OnboardingScaffold.tsx');
    const expected = [
      'WelcomeStep',
      'UsernameStep',
      'PasskeyStep',
      'LinksStep',
      'ReadyStep',
    ];

    for (const component of expected) expect(flow).toContain(`<${component}`);
    expect(scaffold).toContain('ONBOARDING_STEP_COUNT');
    expect(scaffold).toContain('Array.from');
    expect(flow).not.toContain("case 'secureKeys'");
    expect(flow).not.toContain("case 'backup'");
    expect(flow).not.toContain("case 'connect'");
    expect(flow).not.toContain("case 'share'");
  });

  it('keeps Linktree import real and creates an empty page rather than placeholder links', () => {
    const links = source('../../src/onboarding/steps/LinksStep.tsx');

    expect(links).toContain('LinkPageImportSheet');
    expect(links).toContain('saveProfile');
    expect(links).toContain('saveLinks([])');
    expect(links).not.toContain('example.com');
  });

  it('uses product language rather than protocol vocabulary', () => {
    expect(zhHant['ob.welcome.title']).toBe('建立你的可查驗身分');
    expect(zhHant['ob.passkey.title']).toBe('建立通行密鑰');
    expect(zhHant['ob.links.title']).toBe('放上你的連結');
    expect(en['ob.done.title']).toBe('[ Ready ]');

    const files = [
      '../../src/onboarding/steps/WelcomeStep.tsx',
      '../../src/onboarding/steps/UsernameStep.tsx',
      '../../src/onboarding/steps/PasskeyStep.tsx',
      '../../src/onboarding/steps/LinksStep.tsx',
      '../../src/onboarding/steps/ReadyStep.tsx',
    ].map(source).join('\n');
    expect(files).not.toMatch(/\bDID\b|Nostr|public key|seed phrase/u);
  });
});

describe('public page username', () => {
  it('normalizes to lowercase ASCII letters and numbers', () => {
    expect(normalizePublicPageUsernameInput(' Gim_My-26! ')).toBe('gimmy26');
  });

  it('requires 3–30 characters and rejects reserved product paths', () => {
    expect(validatePublicPageUsername('ab')).toEqual({ kind: 'tooShort' });
    expect(validatePublicPageUsername('a'.repeat(31))).toEqual({ kind: 'tooLong' });
    expect(validatePublicPageUsername('settings')).toEqual({ kind: 'reserved' });
    expect(validatePublicPageUsername('gimmy26')).toEqual({ kind: 'valid' });
  });

  it('uses /name without an @ or long identifier', () => {
    expect(publicPagePath('gimmy26')).toBe('creds.id/gimmy26');
  });
});
