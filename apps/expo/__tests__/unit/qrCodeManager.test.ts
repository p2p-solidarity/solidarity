/**
 * QR generation cascade — verifies Swift parity with
 * `QRCodeGenerationService.generateImageCascading` (H → Q → M → L).
 *
 * The `qrcode` engine throws when a payload exceeds the chosen
 * error-correction level's capacity. `generateQrPng` catches that and
 * steps down one level, then reports a clear failure when every level has
 * rejected the payload (or the engine itself isn't loaded). A text SVG is
 * not a QR code and must never be returned as a successful result.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { generateQrPng } from '@/cards/qrCodeManager';

async function engineAvailable(): Promise<boolean> {
  try {
    // `qrcode` ships no .d.ts in this version (same workaround the
    // production loader uses). Cast through unknown so tsc stays happy.
    const dynamicImport = (id: string): Promise<unknown> => import(id);
    const raw = (await dynamicImport('qrcode')) as { toString?: unknown; default?: { toString?: unknown } };
    const candidate = raw.default ?? raw;
    return typeof candidate.toString === 'function';
  } catch {
    return false;
  }
}

describe('generateQrPng — cascading error-correction levels', () => {
  it('loads qrcode with Metro-compatible static syntax', () => {
    const source = readFileSync(
      new URL('../../src/cards/qrCodeManager.ts', import.meta.url),
      'utf8',
    );

    expect(source).not.toContain('@vite-ignore');
    expect(source).not.toMatch(/import\(\s*[^'"`]/u);
  });

  it('emits a real SVG for short payloads', async () => {
    if (!(await engineAvailable())) {
      // This runtime cannot prove the successful engine path; the following
      // capacity test still proves the failure path remains honest.
      return;
    }
    const url = await generateQrPng('hello solidarity');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);

    // Decode and confirm it looks like a real QR SVG, never a text-shaped
    // placeholder that scanners cannot read.
    const b64 = url.slice('data:image/svg+xml;base64,'.length);
    const svg = Buffer.from(b64, 'base64').toString('utf8');
    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('<text')).toBe(false);
  });

  it('rejects a payload that exceeds every QR capacity instead of returning a text SVG', async () => {
    // ~10kB of high-entropy data — exceeds even level-L capacity (~2.9kB
    // binary at version 40), so every level must reject it. This must be an
    // explicit error: a rendered text fallback would look like a QR but be
    // impossible to scan.
    const huge = 'x'.repeat(10_000);
    await expect(generateQrPng(huge)).rejects.toThrow('QR');
  });

  it('respects startingLevel option without throwing', async () => {
    if (!(await engineAvailable())) return;
    const url = await generateQrPng('eyJhbGciOiJFZERTQSJ9.payload.sig', { startingLevel: 'L' });
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
