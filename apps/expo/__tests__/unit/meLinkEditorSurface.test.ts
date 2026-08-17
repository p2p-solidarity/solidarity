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
    expect(sheet).toContain('const editing = initialLink !== null');
    expect(sheet).toContain('{editing ? (\n              <ThemedTextInput');
    expect(sheet).toContain('{editing ? (\n              <LinkVisibilityControl');
    expect(sheet).toContain("visibility: 'public'");
    expect(sheet).toContain(
      'label: detected.preset === null ? detected.label : t(`profileLink.preset.${detected.preset}`)'
    );
    expect(route.split('\n').length).toBeLessThan(647);
  });

  it('prepares the npub claim before save and previews only non-public links', () => {
    const route = source('../../app/me/edit.tsx');
    const avatarEditor = source('../../src/components/me/useAvatarEditor.ts');
    const claimPreparation = route.indexOf('const preparedClaim = await prepareNostrClaimForSave');
    const profileSave = route.indexOf('const saved = await saveProfile');

    expect(claimPreparation).toBeGreaterThan(-1);
    expect(profileSave).toBeGreaterThan(claimPreparation);
    expect(route).toContain('const willAutoRepublish = autoRepublish;');
    expect(route).toContain('allowNostrProvisioning: true');
    expect(route).toContain('allowNostrProvisioning: false');
    expect(route).toContain('isNostrPublishOutcomePartiallyAccepted');
    expect(route).toContain("return 'partialSuccess'");
    expect(route).toContain("summary: t('meEdit.publishSetupFailed')");
    expect(avatarEditor).toContain("committed === 'partialSuccess'");
    expect(route).not.toContain('shouldAutoRepublish');
    expect(route).toContain('if (hasHidden) {');
    expect(route).not.toContain('if (willAutoRepublish || hasHidden)');
  });

  it('keeps add-link persistent and returns only an untouched focused add flow', () => {
    const tab = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const links = source('../../src/components/me/ProfileLinksList.tsx');
    const editor = source('../../app/me/edit.tsx');

    expect(tab).toContain("params: { add: '1' }");
    expect(page).toContain('onAddFirstLink={onAddLink}');
    expect(links).toContain('onPress={onAddFirstLink}');
    expect(links).toContain("t('meHome.addLink')");
    expect(editor).toContain('focusedEditorMode({ add, avatar })');
    expect(editor).toContain('shouldReturnAfterFocusedCancel(focusedMode, hasDraftEdits)');
    expect(editor).toContain('setHasDraftEdits(true)');
    expect(editor).not.toContain('addShortcutActive');
  });

  it('opens the avatar picker from Me and makes focused avatar exits consistent', () => {
    const tab = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const hero = source('../../src/components/me/ProfileHero.tsx');
    const editor = source('../../app/me/edit.tsx');
    const avatarEditor = source('../../src/components/me/useAvatarEditor.ts');

    expect(tab).toContain("params: { avatar: '1' }");
    expect(page).toContain('onEditAvatar={onEditAvatar}');
    expect(hero).toContain('onPress={onEditAvatar}');
    expect(editor).toContain('initiallyOpen: focusedMode ===');
    expect(editor).toContain('returnToMeOnFinish: shouldReturnAfterFocusedCancel');
    expect(avatarEditor).toContain('useState(initiallyOpen)');
    expect(avatarEditor).toContain('if (returnToMeOnFinish) safeBack();');
    expect(avatarEditor.match(/safeBack\(\)/gu)).toHaveLength(1);
  });

  it('announces a real link summary when a legacy editable link has no label', () => {
    const list = source('../../src/components/me/EditableLinksList.tsx');
    expect(list).toContain('link.label.trim() || linkSummary(link)');
  });

  it('has matching add-link copy in both locales', () => {
    expect(en['meEdit.linkSheet.pasteLabel']).toBe('Paste a link');
    expect(zhHant['meEdit.linkSheet.pasteLabel']).toBe('貼上連結');
    expect(en['meEdit.linkSheet.add']).toBe('Add');
    expect(zhHant['meEdit.linkSheet.add']).toBe('加入');
    expect(en['meEdit.publishSetupFailed']).toContain("weren't saved");
    expect(zhHant['meEdit.publishSetupFailed']).toContain('尚未儲存');
  });
});
