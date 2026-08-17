import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const enCatalog: Readonly<Record<string, string>> = en;
const zhHantCatalog: Readonly<Record<string, string>> = zhHant;

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('v2 Developer Options surface', () => {
  it('keeps one gated Advanced entry and cannot enable itself from a deep link', () => {
    const advanced = source('../../app/settings/advanced.tsx');
    const developer = source('../../app/settings/developer.tsx');
    const verificationRoute = source('../../app/settings/developer/verification.tsx');

    expect(advanced.match(/router\.push\('\/settings\/developer'\)/gu)).toHaveLength(1);
    expect(developer).toContain('if (!developerMode)');
    expect(developer).not.toContain("setPref('developerMode', v)");
    expect(verificationRoute).toContain(
      'const developerMode = usePreferences((state) => state.developerMode)'
    );
    expect(verificationRoute).toContain('if (!developerMode)');
    expect(verificationRoute).toContain('<Redirect href="/settings/advanced" />');
  });

  it('resets every local record, restores preferences, and returns to onboarding', () => {
    const advanced = source('../../app/settings/advanced.tsx');
    const resetAction = advanced.slice(
      advanced.indexOf('const resetAppData'),
      advanced.indexOf('const onResetPassport')
    );

    expect(resetAction).toContain('clearAllData();');
    expect(resetAction).toContain('resetPrefs();');
    expect(resetAction).toContain("router.replace('/onboarding');");
    expect(resetAction.indexOf('clearAllData();')).toBeLessThan(
      resetAction.indexOf('resetPrefs();')
    );
    expect(resetAction.indexOf('resetPrefs();')).toBeLessThan(
      resetAction.indexOf("router.replace('/onboarding');")
    );
    expect(resetAction).not.toContain('getAllKeys()');
    expect(resetAction).not.toContain("startsWith('contact:')");
  });

  it('does not reveal the hidden developer unlock gesture in Advanced', () => {
    const advanced = source('../../app/settings/advanced.tsx');

    expect(advanced).not.toContain('advanced.devModeHint');
    expect(advanced).not.toMatch(/<Text(?:\s|>)/u);
  });

  it('follows the six product-pipeline groups and exposes only real tools', () => {
    const developer = source('../../app/settings/developer.tsx');
    const keys = [
      'developer.identityKeys.header',
      'developer.credentials.header',
      'developer.present.header',
      'developer.receive.header',
      'developer.checkEngine.header',
      'developer.publishSync.header',
      'developer.simulators.header',
      'developer.dangerZone.header',
    ] as const;
    const positions = keys.map((key) => developer.indexOf(`t('${key}')`));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(developer).toContain(
      "router.push({ pathname: '/settings/dids', params: { readOnly: '1' } })"
    );

    for (const route of [
      '/credentials',
      '/settings/developer/verification',
      '/scan',
      '/settings/connections',
      '/settings/data-sync',
    ]) {
      expect(developer).toContain(`router.push('${route}')`);
    }

    for (const retiredRoute of [
      '/settings/security',
      '/id/zk-settings',
      '/settings/identity-export',
      '/settings/oidc-request',
      '/dev/nostr',
      '/dev/p2p',
      '/dev/dag',
      '/dev/common-friends',
      '/dev/pear-echo',
      '/dev/pear-lane',
      '/dev/identity-tree',
    ]) {
      expect(developer).not.toContain(retiredRoute);
    }
    expect(developer).not.toContain("router.push('/settings/dids')");

    expect(developer).toContain("setPref('simulateNfc', next)");
    expect(developer).toContain('invalidateCachedNostrResult');
    expect(developer).toContain('invalidateCachedAtprotoResult');
  });

  it('keeps destructive developer-only actions inside Developer Options', () => {
    const advanced = source('../../app/settings/advanced.tsx');
    const developer = source('../../app/settings/developer.tsx');

    expect(developer).toContain('onWipeEverything');
    expect(developer).toContain("setPref('developerMode', false)");
    expect(advanced).not.toContain('onWipeEverything');
    expect(advanced).not.toContain('onDisableDeveloperMode');
  });

  it('ships paired human and technical copy for every new row', () => {
    const expected = {
      'developer.identityKeys.header': ['Identity & Keys', '身分與金鑰'],
      'developer.credentials.header': ['Credentials', '憑證'],
      'developer.present.header': ['Present', '出示'],
      'developer.receive.header': ['Receive', '領取'],
      'developer.checkEngine.header': ['Check Engine', '綠勾引擎'],
      'developer.publishSync.header': ['Publishing & Sync', '發布與同步'],
      'developer.simulators.header': ['Simulators', '模擬器'],
      'developer.dangerZone.header': ['Danger Zone', '危險區'],
    } as const;

    for (const [key, [english, chinese]] of Object.entries(expected)) {
      expect(enCatalog[key]).toBe(english);
      expect(zhHantCatalog[key]).toBe(chinese);
    }
  });
});
