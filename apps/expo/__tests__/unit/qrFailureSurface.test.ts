import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('QR failure surfaces', () => {
  it('keeps an oversized offline link copyable/shareable while withholding its QR image', () => {
    const share = source('../../src/components/me/ProfileShareSurface.tsx');
    const sheet = source('../../src/components/me/ProfileShareSheetContent.tsx');

    expect(share).toContain('profileShareQrIsOversize');
    expect(share).toContain("kind: 'oversize'");
    expect(sheet).toContain("kind: 'oversize'");
    expect(sheet).toContain('const visibleQrState: ProfileShareQrState = qrBlockedBySize');
    expect(sheet).toContain("t('meShare.qrTooLarge')");
    expect(sheet).toContain('disabled={qrImageUri === null}');
    expect(sheet).toContain('onCopy(selected.url)');
    expect(sheet).toContain('onShare(selected.url)');
  });

  it('settles onboarding QR failure to an explicit visible state', () => {
    const onboarding = source('../../src/onboarding/steps/ShareStep.tsx');

    expect(onboarding).toContain('setQrFailed(true)');
    expect(onboarding).toContain("t('meShare.qrError')");
    expect(onboarding).toContain('fragment?.oversize === true');
  });
});
