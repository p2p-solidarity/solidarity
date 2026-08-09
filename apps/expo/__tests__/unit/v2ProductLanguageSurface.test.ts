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
});
