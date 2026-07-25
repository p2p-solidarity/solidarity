import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('large share QR rendering', () => {
  it('Share Settings renders generated QR images instead of raw payload QR nodes', () => {
    const text = source('../../app/settings/share-settings.tsx');

    expect(text).not.toContain("from 'react-native-qrcode-svg'");
    expect(text).toContain('buildRuntimeSolidarityQrWire');
    expect(text).toContain('generateQrPng');
  });

  it('Solidarity QR redirects to the canonical Share Settings (G2 legacy QR dedupe)', () => {
    const text = source('../../app/settings/solidarity-qr.tsx');

    // The legacy QR is now built in exactly one place (share-settings). This
    // route must not duplicate the build/forever-spinner logic — it redirects.
    expect(text).toContain('Redirect');
    expect(text).toContain('/settings/share-settings');
    expect(text).not.toContain('buildRuntimeSolidarityQrWire');
    expect(text).not.toContain('generateQrPng');
  });
});
