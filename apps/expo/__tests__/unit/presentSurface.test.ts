import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Present product surface', () => {
  it('keeps the tab route thin and delegates to the product Present screen', () => {
    const route = source('../../app/(tabs)/verify/index.tsx');

    expect(route).toContain("from '@/components/present/PresentScreen'");
    expect(route).toContain('<PresentScreen />');
  });

  it('orders the product header, segments, and selected content without developer chrome', () => {
    const product = source('../../src/components/present/PresentScreen.tsx');
    const headerIndex = product.indexOf('<PresentHeader');
    const segmentIndex = product.indexOf('<PresentSegmentedControl');
    const cardIndex = product.indexOf('<CardMode');
    const attestationsIndex = product.indexOf('<AttestationsMode');

    expect(headerIndex).toBeGreaterThan(-1);
    expect(segmentIndex).toBeGreaterThan(headerIndex);
    expect(cardIndex).toBeGreaterThan(segmentIndex);
    expect(attestationsIndex).toBeGreaterThan(cardIndex);
    expect(product).toContain('accessibilityRole="tablist"');
    expect(product).toContain('accessibilityRole="tab"');
    expect(product).toContain('accessibilityState={{ selected }}');
    expect(product).not.toMatch(/OIDC|Oidc|SelectiveDisclosures|importRawCredential|Import Raw Credential/u);
  });

  it('keeps Public Page read-only, Card Only toggleable, and routes card actions honestly', () => {
    const product = source('../../src/components/present/PresentScreen.tsx');
    const cardMode = product.slice(
      product.indexOf('function CardMode'),
      product.indexOf('function PublicPageSection')
    );
    const publicPage = product.slice(
      product.indexOf('function PublicPageSection'),
      product.indexOf('function CardOnlySection')
    );

    expect(cardMode.indexOf('<PublicPageSection')).toBeGreaterThan(
      cardMode.indexOf('<PresentCard')
    );
    expect(cardMode.indexOf('<CardOnlySection')).toBeGreaterThan(
      cardMode.indexOf('<PublicPageSection')
    );
    expect(cardMode).toContain("model.cardState.kind === 'ready'");
    expect(publicPage).not.toContain('<Switch');
    expect(product).toContain('<Switch');
    expect(product).toContain("router.push('/settings/share-settings')");
    expect(product).toContain("router.push('/cards/edit')");
    expect(product).toContain("router.push('/scan')");
    expect(product).not.toContain('buildRuntimeSolidarityQrWire');
    expect(product).not.toContain('generateQrPng');
    const card = [
      source('../../src/components/present/PresentCard.tsx'),
      source('../../src/components/present/PresentCardVisual.tsx'),
    ].join('\n');
    expect(card).toContain('LinearGradient');
    expect(card).toContain('animalImageSource');
    expect(card).toContain('const CARD_RADIUS = 20');
    expect(card).toContain('borderRadius: CARD_RADIUS');
    expect(card).toContain('generateQrPng');
    expect(card).toContain('displayProfileShareUrl');
    expect(card).toContain('cardAccentHex');
    expect(card).toContain('usePreferences');
    expect(card).toContain('buildRuntimeSolidarityQrWire');
    expect(card).toContain('shareFieldPreferencesFromFields');
    expect(card).toContain('sealedRoute: page?.url');
    expect(card).toContain('model.selectedCardOnlyCount');
    expect(card).toContain('ANIMAL_GRADIENT_END');
    expect(card).toContain('enableGlow');
    expect(card).toContain('SensorType.ROTATION');
    expect(card).toContain('useReducedMotion');
    expect(card).toContain("backfaceVisibility: 'hidden'");
    expect(card).toContain("t('present.flipCard')");
  });

  it('shows only presentable Passport attestations through the existing credential route', () => {
    const product = source('../../src/components/present/PresentScreen.tsx');
    const attestations = source('../../src/components/present/PresentAttestations.tsx');

    expect(product).toContain('useDisplayClaims()');
    expect(product).toContain('filterAvailablePassportPresentationClaims');
    expect(product).toContain('hasPassportShowWitnessSafe');
    expect(attestations).toContain("pathname: '/credentials/[id]'");
    expect(attestations).toContain('claimId: claim.id');
    expect(attestations).toContain("router.push('/passport')");
  });

  it('preserves the former Verify tools behind exactly one gated developer link', () => {
    const developerScreen = source(
      '../../src/components/developer/VerificationToolsScreen.tsx'
    );
    const developerRoute = source('../../app/settings/developer/verification.tsx');
    const developerSettings = source('../../app/settings/developer.tsx');
    const verificationLinks = developerSettings.match(
      /router\.push\('\/settings\/developer\/verification'\)/gu
    );

    expect(developerScreen).toContain('VerifiedCredentialsSection');
    expect(developerScreen).toContain('SelectiveDisclosuresSection');
    expect(developerScreen).toContain('meTab.importRawCredential');
    expect(developerScreen).not.toContain('OidcSection');
    expect(developerScreen).not.toContain('/settings/oidc-request');
    expect(developerRoute).toContain('<VerificationToolsScreen');
    expect(developerRoute).toContain("safeBack('/settings/developer')");
    expect(verificationLinks).toHaveLength(1);
    expect(developerSettings.indexOf("router.push('/settings/developer/verification')"))
      .toBeGreaterThan(developerSettings.indexOf('{developerMode ?'));
  });

  it('ships the exact v2 labels in zh-Hant first and English', () => {
    const keys = [
      'present.title',
      'present.scanSomeone',
      'present.card',
      'present.attestations',
      'present.publicPage',
      'present.cardOnly',
      'present.showCardQr',
      'present.createCard',
    ] as const;

    expect(keys.map((key) => zhHant[key])).toEqual([
      '出示',
      '掃描對方',
      '名片',
      '證明',
      '公開頁',
      '名片才有',
      '顯示名片 QR',
      '新增名片',
    ]);
    expect(keys.map((key) => en[key])).toEqual([
      'Present',
      'Scan Someone',
      'Card',
      'Attestations',
      'Public Page',
      'Card Only',
      'Show Card QR',
      'Create Card',
    ]);
  });

  it('ships honest loading and error copy for Attestations in both locales', () => {
    expect(en['present.loadingAttestations']).toBe('Loading attestations…');
    expect(en['present.attestationsLoadError']).toBe("Couldn't load attestations.");
    expect(zhHant['present.loadingAttestations']).toBe('正在載入證明…');
    expect(zhHant['present.attestationsLoadError']).toBe('無法載入證明。');
  });
});
