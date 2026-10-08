import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('global overlays above native sheets', () => {
  it('uses a window-level iOS host instead of presenting a second native modal', () => {
    const overlayUrl = new URL('../../src/components/common/WindowOverlay.tsx', import.meta.url);

    expect(existsSync(overlayUrl)).toBe(true);
    if (!existsSync(overlayUrl)) return;

    const overlay = readFileSync(overlayUrl, 'utf8');
    expect(overlay).toContain("import { FullWindowOverlay } from 'react-native-screens'");
    expect(overlay).toContain("Platform.OS === 'ios'");
    expect(overlay).toContain('<FullWindowOverlay');
    expect(overlay).toContain('<Modal');
  });

  it('routes every imperative root overlay through the shared window host', () => {
    for (const path of [
      '../../src/feedback/confirmDialog.tsx',
      '../../src/feedback/appAlert.tsx',
      '../../src/pear/consent.tsx',
    ]) {
      const file = source(path);
      expect(file).toContain("from '@/components/common/WindowOverlay'");
      expect(file).toContain('<WindowOverlay');
      expect(file).not.toMatch(/<Modal(?:\s|>)/u);
    }
  });

  it('keeps the three sheet-local confirmation flows on the fixed shared host', () => {
    for (const path of [
      '../../src/components/people/PersonDetailMoreSheet.tsx',
      '../../src/components/cards/BusinessCardActionsSheet.tsx',
      '../../src/components/scan/VerifiedPageResultSheet.tsx',
    ]) {
      expect(source(path)).toContain('confirmDialog(');
    }
  });
});
