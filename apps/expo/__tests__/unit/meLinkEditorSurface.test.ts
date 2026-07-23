import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Me link editor surface', () => {
  it('keeps add compact and reserves label plus visibility for per-link editing', () => {
    const route = source('../../app/me/edit.tsx');
    const sheet = source('../../src/components/me/AddLinkSheet.tsx');
    const list = source('../../src/components/me/EditableLinksList.tsx');

    expect(route).toContain('<EditableLinksList');
    expect(route).toContain('<AddLinkSheet');
    expect(route).not.toContain('<LinkVisibilityControl');
    expect(list).not.toContain('ThemedTextInput');
    expect(list).not.toContain('LinkVisibilityControl');
    expect(sheet).toContain("const editing = initialLink !== null");
    expect(sheet).toContain("{editing ? (\n              <ThemedTextInput");
    expect(sheet).toContain("{editing ? (\n              <LinkVisibilityControl");
    expect(sheet).toContain("visibility: 'public'");
    expect(route.split('\n').length).toBeLessThan(647);
  });

  it('prepares the npub claim before save and previews only non-public links', () => {
    const route = source('../../app/me/edit.tsx');
    const claimPreparation = route.indexOf(
      'const preparedClaim = await prepareNostrClaimForSave'
    );
    const profileSave = route.indexOf('const saved = await saveProfile');

    expect(claimPreparation).toBeGreaterThan(-1);
    expect(profileSave).toBeGreaterThan(claimPreparation);
    expect(route).toContain('const willAutoRepublish = autoRepublish;');
    expect(route).not.toContain('shouldAutoRepublish');
    expect(route).toContain('if (hasHidden) {');
    expect(route).not.toContain('if (willAutoRepublish || hasHidden)');
  });

  it('auto-opens AddLinkSheet from the Me empty-state CTA', () => {
    const tab = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const links = source('../../src/components/me/ProfileLinksList.tsx');
    const editor = source('../../app/me/edit.tsx');

    expect(tab).toContain("params: { add: '1' }");
    expect(page).toContain('onAddFirstLink={onAddLink}');
    expect(links).toContain('onPress={onAddFirstLink}');
    expect(editor).toContain("add === '1' ? { kind: 'add' } : null");
  });

  it('has matching add-link copy in both locales', () => {
    expect(en['meEdit.linkSheet.pasteLabel']).toBe('Paste a link');
    expect(zhHant['meEdit.linkSheet.pasteLabel']).toBe('貼上連結');
    expect(en['meEdit.linkSheet.add']).toBe('Add');
    expect(zhHant['meEdit.linkSheet.add']).toBe('加入');
  });
});
