import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const PRODUCT_PREFIXES = [
  'tab.',
  'mePage.',
  'meHome.',
  'meEdit.',
  'present.',
  'peopleList.',
  'settingsHub.',
  'advanced.',
  'connectionsSettings.',
  'dataSync.',
  'legacyCard.',
] as const;

const DEVELOPER_ONLY_KEYS = [
  /^advanced\.(?:devMode|disableDevMode|oidcScanner|simulateNfc|wipe|zkSettings)/u,
  /^dataSync\.(?:resetKeys|section\.keyRecovery)/u,
] as const;

function productEntries(catalog: Readonly<Record<string, string>>) {
  return Object.entries(catalog)
    .filter(([key]) => PRODUCT_PREFIXES.some((prefix) => key.startsWith(prefix)))
    .filter(([key]) => !DEVELOPER_ONLY_KEYS.some((pattern) => pattern.test(key)))
    .map(([key, value]) => [key, value.replace(/\{\{[^}]+\}\}/gu, '')] as const);
}

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('v2 product terminology boundary', () => {
  it('keeps protocol and credential jargon out of reachable English copy', () => {
    const banned = /\b(?:DID|VCs?|SD-JWT|ZK|Nostr|relay|handle|OIDC|Pear|credentials?)\b|selective disclosure/iu;
    expect(productEntries(en).filter(([, value]) => banned.test(value))).toEqual([]);
  });

  it('keeps protocol and legacy product vocabulary out of reachable Chinese copy', () => {
    const banned = /DID|\bVCs?\b|SD-JWT|ZK|Nostr|relay|OIDC|Pear|憑證|中繼站|選擇性揭露|助記詞|宣稱|徽章/iu;
    expect(productEntries(zhHant).filter(([, value]) => banned.test(value))).toEqual([]);
  });

  it('routes account/profile entries to product screens and technical tools to Developer Options', () => {
    const settings = source('../../app/settings/index.tsx');
    const data = source('../../app/settings/data-sync.tsx');

    expect(settings).toContain("router.push('/me/edit')");
    expect(settings).not.toContain("router.push('/settings/vc')");
    expect(settings).not.toContain("router.push('/settings/dids')");
    expect(settings).not.toContain("router.push('/settings/identity-export')");
    expect(data).not.toContain("router.push('/settings/vc')");
    expect(data).not.toContain('exportGraph.todo');
  });
});
