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

  it('keeps technical publishing deep links and Contacts peer controls behind Developer Options', () => {
    const connections = source('../../app/settings/connections.tsx');
    const nostr = source('../../app/verify/nostr.tsx');
    const cardExchange = source('../../src/components/people/CardExchangeSection.tsx');
    const pearConnect = source('../../src/components/people/PearConnectSection.tsx');

    for (const route of [connections, nostr]) {
      expect(route).toContain(
        "const developerMode = usePreferences((state) => state.developerMode)"
      );
      expect(route).toContain('if (!developerMode) return <Redirect href="/settings/advanced" />;');
    }

    for (const section of [cardExchange, pearConnect]) {
      expect(section).toContain(
        "const developerMode = usePreferences((state) => state.developerMode)"
      );
      expect(section).toContain('if (!developerMode) return null;');
    }
  });

  it('keeps Page publication badges and saved-page rows human-facing', () => {
    const badgeLabelKeys = [
      'badges.nostr.checking',
      'badges.nostr.verifiedLabel',
      'badges.nostr.declaredLabel',
      'badges.nostr.staleLabel',
    ] as const;
    const technicalDetailKeys = [
      'badges.nostr.evidenceTitle',
      'badges.nostr.evidence.verified',
      'badges.nostr.evidence.declared',
      'badges.nostr.evidence.stale',
      'badges.nostr.evidence.npubLine',
      'badges.nostr.evidence.direction1Held',
      'badges.nostr.evidence.direction1Missing',
      'badges.nostr.evidence.direction2Held',
      'badges.nostr.evidence.direction2Missing',
      'badges.nostr.evidence.direction2Unknown',
      'badges.nostr.evidence.lastUpdatedLine',
      'badges.website.evidence.didDocument',
    ] as const;
    const hardTerms = /DID|kind-0|npub|relays?|public key|中繼站|公鑰/iu;
    const protocolTerms = /DID|Nostr|kind-0|npub|relays?|public key|中繼站|公鑰/iu;

    for (const key of badgeLabelKeys) {
      expect(en[key]).toContain('Nostr');
      expect(zhHant[key]).toContain('Nostr');
      expect(en[key]).not.toMatch(hardTerms);
      expect(zhHant[key]).not.toMatch(hardTerms);
    }
    for (const key of technicalDetailKeys) {
      expect(en[key]).not.toMatch(protocolTerms);
      expect(zhHant[key]).not.toMatch(protocolTerms);
    }

    const badges = source('../../src/components/me/ProfileBadgeChips.tsx');
    expect(badges).toMatch(/nostrUploaded\s+\? record\.alsoKnownAs/u);
    const savedPages = source('../../src/components/people/VerifiedPagesSection.tsx');
    expect(savedPages).not.toContain('shortDid');
  });
});
