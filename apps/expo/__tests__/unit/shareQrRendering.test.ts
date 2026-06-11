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

  it('Solidarity QR renders generated QR images instead of raw payload QR nodes', () => {
    const text = source('../../app/settings/solidarity-qr.tsx');

    expect(text).not.toContain("from 'react-native-qrcode-svg'");
    expect(text).toContain('buildRuntimeSolidarityQrWire');
    expect(text).toContain('generateQrPng');
  });
});
