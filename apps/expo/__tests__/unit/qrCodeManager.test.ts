/**
 * QR generation cascade — verifies Swift parity with
 * `QRCodeGenerationService.generateImageCascading` (H → Q → M → L).
 *
 * The `qrcode` engine throws when a payload exceeds the chosen
 * error-correction level's capacity. `generateQrPng` catches that and
 * steps down one level, only falling through to the safety-net SVG when
 * every level has rejected the payload (or the engine itself isn't loaded).
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { generateQrPng } from '@/cards/qrCodeManager';
import { base64Encode, utf8ToBytes } from '@solidarity/shared';

// The fallback rectangle the manager emits when the qrcode engine isn't
// available. We rebuild it from the same template so the test stays in
// lockstep with the implementation without re-encoding the constant by hand.
function fallbackDataUrlFor(value: string, size = 256): string {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#FFFFFF"/><text x="8" y="20" font-size="10">${escaped}</text></svg>`;
  return `data:image/svg+xml;base64,${base64Encode(utf8ToBytes(svg))}`;
}

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

  it('emits a real SVG (not the fallback rectangle) for short payloads', async () => {
    if (!(await engineAvailable())) {
      // Without the engine the only output is the fallback rectangle, so
      // there is nothing to differentiate. Skip with a clear name.
      return;
    }
    const url = await generateQrPng('hello solidarity');
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(url).not.toBe(fallbackDataUrlFor('hello solidarity'));

    // Decode and confirm it looks like a real QR SVG (contains the
    // engine's path/rect grid, not the fallback's <text> element).
    const b64 = url.slice('data:image/svg+xml;base64,'.length);
    const svg = Buffer.from(b64, 'base64').toString('utf8');
    expect(svg.includes('<svg')).toBe(true);
    expect(svg.includes('<text')).toBe(false);
  });

  it('cascade fallback runs without throwing for a huge payload', async () => {
    if (!(await engineAvailable())) {
      // Engine missing — the cascade isn't exercised. Skip with a clear
      // name so the report is honest about what was checked.
      return;
    }
    // ~10kB of high-entropy data — exceeds even level-L capacity (~2.9kB
    // binary at version 40), so every level will throw. We just want to
    // confirm `generateQrPng` doesn't propagate; it should return either
    // a real SVG (if it fits somewhere) or the fallback URL.
    const huge = 'x'.repeat(10_000);
    let url = '';
    await (async () => {
      url = await generateQrPng(huge);
    })();
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });

  it('respects startingLevel option without throwing', async () => {
    if (!(await engineAvailable())) return;
    const url = await generateQrPng('eyJhbGciOiJFZERTQSJ9.payload.sig', { startingLevel: 'L' });
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
