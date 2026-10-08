import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('v2 settings surface', () => {
  it('uses the Page-tab square list treatment for settings rows and dividers', () => {
    const blocks = source('../../src/components/settings/SettingsBlocks.tsx');

    expect(blocks).toContain('rounded-none');
    expect(blocks).toContain('borderBottomWidth: 0.5');
    expect(blocks).not.toContain('rounded-xl');
  });

  it('puts the public page first and routes every product row to a real screen', () => {
    const settings = source('../../app/settings/index.tsx');
    const sections = [
      'settingsHub.publicPage',
      'settingsHub.accountIdentity',
      'settingsHub.plan',
      'settingsHub.preferences',
      'settingsHub.data',
      'settingsHub.advancedSection',
      'settingsHub.about',
    ];

    const positions = sections.map((section) => settings.indexOf(section));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(settings).toContain("router.push('/me/edit')");
    expect(settings).toContain("router.push('/settings/security')");
    expect(settings).toContain("router.push('/settings/username')");
    expect(settings.indexOf("router.push('/settings/username')")).toBeLessThan(
      settings.indexOf("router.push('/me/edit')")
    );
    expect(settings).toContain("router.push('/settings/backup')");
    expect(settings).toContain("router.push('/settings/pro')");
    expect(settings).toContain("router.push('/settings/appearance')");
    expect(settings).toContain("router.push('/settings/language')");
    expect(settings).toContain("router.push('/settings/notifications')");
    expect(settings).toContain("pathname: '/(tabs)/people'");
    expect(settings).toContain("params: { edit: '1' }");
    expect(settings).toContain("router.push('/contacts/import-vcf')");
    expect(settings).toContain("router.push('/settings/data-sync')");
    expect(settings).toContain("router.push('/settings/advanced')");
    expect(settings).toContain("router.push('/settings/developer')");
    expect(settings).toContain("router.push('/settings/privacy')");

    expect(settings).not.toContain('legacyCard.section');
    expect(settings).not.toContain('settingsHub.guide');
  });

  it('checks and publishes the short name instead of treating a local preference as reserved', () => {
    const username = source('../../app/settings/username.tsx');

    expect(username).toContain('normalizePublicPageUsernameInput');
    expect(username).toContain('validatePublicPageUsername');
    expect(username).toContain('publicPagePath');
    expect(username).toContain('preferences.publicPageUsername');
    expect(username).toContain("setPreference('publicPageUsername'");
    expect(username).toContain("t('settingsUsername.serviceNote')");
    expect(username).toContain('useNameAvailability');
    expect(username).toContain('publishChosenPageName');
    expect(username).toContain('creds.id/@');
  });

  it('uses plain product language in both supported locales', () => {
    expect(en['settingsHub.publicPage']).toBe('Public Page');
    expect(zhHant['settingsHub.publicPage']).toBe('公開頁面');
    expect(en['settingsHub.myUsername']).toBe('Username');
    expect(zhHant['settingsHub.myUsername']).toBe('我的名稱');
    expect(en['settingsHub.advanced']).toBe('Reset Options');
    expect(zhHant['settingsHub.advanced']).toBe('重設選項');
    expect(en['settingsHub.accountProtection']).toBe('Account Protection');
    expect(zhHant['settingsHub.accountProtection']).toBe('帳號保護');
    // Plain product language: the service note names the creds.id service,
    // not protocol vocabulary (Nostr/relay stays out of settings copy).
    expect(en['settingsUsername.serviceNote']).toContain('creds.id');
    expect(zhHant['settingsUsername.serviceNote']).toContain('creds.id');
  });
});
