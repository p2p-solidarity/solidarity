import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('v2 product language surfaces', () => {
  it('keeps scan guidance human-facing and removes the protocol placeholder', () => {
    const scan = source('../../app/scan/index.tsx');

    expect(scan).not.toContain('SolidarityPlaceholderCard');
    expect(scan).not.toContain('title="Protocol Router"');
    expect(scan).not.toContain('subtitle="Supports OID4VP');
    expect(scan).toContain("t('scan.title')");
    expect(scan).toContain("t('scan.readyHint')");
    expect(scan).toContain("t('scan.receiving'");
    expect(scan).toContain("t('scan.scanning')");

    expect(en['scan.title']).toBe('Scan QR');
    expect(zhHant['scan.title']).toBe('掃描 QR');

    const scanner = source('../../src/scan/QrScanner.tsx');
    expect(scanner).toContain('useCameraPermissionControl()');
    expect(scanner).toContain("permission.state === 'prompt'");
    expect(scanner).toContain("t('scan.permission.allow')");
  });

  it('describes shared field status without VC terminology', () => {
    const rows = source('../../src/components/settings/ShareSettingsRows.tsx');

    expect(rows).not.toMatch(/Shared but not in VC|VC: verified|VC: self-attested|Not in VC/u);
    expect(rows).toContain("t('shareSettings.status.sharedUnverified')");
    expect(rows).toContain("t('shareSettings.status.verified')");
    expect(rows).toContain("t('shareSettings.status.selfDeclared')");
    expect(rows).toContain("t('shareSettings.status.unverified')");
  });

  it('keeps the normal Present attestation path free of protocol details', () => {
    const attestations = source('../../src/components/present/PresentAttestations.tsx');
    const detail = source('../../app/credentials/[id].tsx');
    const result = source('../../src/scan/passportShowResult.ts');

    expect(attestations).toContain("product: '1'");
    expect(detail).toContain('isProductContext');
    expect(detail).toContain('ProductCredentialMetadata');
    expect(result).not.toContain('reason: result.reason');
    expect(result).not.toContain('reason: `openac_show');

    const keys = [
      'credentialDetail.loading',
      'credentialDetail.metadataHeader',
      'credentialDetail.notFound',
      'credentialDetail.regenerate',
      'credentialDetail.removedToast',
      'credentialDetail.title',
      'passportShow.intro',
      'passportShow.scanChallenge',
      'passportShow.presentWithout',
      'passportShow.timeBucketHint',
      'passportShow.scanPrompt',
      'passportShow.footerChallenge',
      'passportShow.footerTimeBucket',
      'passportShow.challengeHint',
    ] as const;
    const banned = /credential|zero-knowledge|\b(?:DID|VC|ZK)\b|nonce|challenge|憑證|零知識/iu;
    for (const key of keys) {
      expect(en[key]).not.toMatch(banned);
      expect(zhHant[key]).not.toMatch(banned);
    }
  });

  it('keeps credential detail and presentation QR details product-safe outside Developer Mode', () => {
    const detail = source('../../app/credentials/[id].tsx');
    const sheet = source('../../src/components/credentials/PresentationSheet.tsx');
    const passportPresentation = source(
      '../../src/components/credentials/PassportShowPresentation.tsx'
    );
    const proofQr = source('../../src/components/credentials/PresentationProofQr.tsx');
    const badges = source('../../src/components/me/ProfileBadgeChips.tsx');

    expect(detail).toContain(
      'const developerMode = usePreferences((state) => state.developerMode);'
    );
    expect(detail).toContain("const isProductContext = !developerMode || product === '1';");
    expect(detail).toContain('showClaimDetails={!isProductContext}');
    expect(detail).toContain('productMode={isProductContext}');

    expect(sheet).toContain('readonly productMode?: boolean;');
    expect(sheet).toContain('productMode = false,');
    expect(sheet).toContain('showClaimDetails={!productMode}');
    expect(passportPresentation).toContain('readonly showClaimDetails?: boolean;');
    expect(passportPresentation).toContain('showClaimDetails={showClaimDetails}');
    expect(proofQr).toContain('readonly showClaimDetails?: boolean;');
    expect(proofQr).toContain('showClaimDetails = true,');
    expect(proofQr).toContain('{showClaimDetails ? (');
    expect(proofQr).toContain('{showClaimDetails && selectedClaims.length > 0 ?');
    expect(proofQr).toContain('{showClaimDetails && footerText ?');

    expect(badges).toContain("params: { id: passport.id, product: '1' }");
  });

  it('gives every public Page link a nonempty accessible name', () => {
    const pagePreview = source('../../src/components/me/PageLivePreview.tsx');

    expect(pagePreview).toContain('accessibilityLabel={item.title.trim() || url}');
  });

  it('labels the presentation QR as a localized product-safe image', () => {
    const proofQr = source('../../src/components/credentials/PresentationProofQr.tsx');

    expect(proofQr).toContain("import { useTranslation } from '@/i18n';");
    expect(proofQr).toContain('const { t } = useTranslation();');
    expect(proofQr).toContain('accessibilityRole="image"');
    expect(proofQr).toContain("accessibilityLabel={t('present.verificationQr')}");
    expect(en['present.verificationQr']).toBe('Verification QR');
    expect(zhHant['present.verificationQr']).toBe('驗證 QR');
  });
});
