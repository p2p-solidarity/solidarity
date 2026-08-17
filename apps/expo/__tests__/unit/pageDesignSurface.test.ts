import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

const source = (path: string) => readFileSync(resolve(import.meta.dir, path), 'utf8');

describe('v2 Page design surface', () => {
  it('keeps Page appearance in a live-preview sheet instead of app appearance settings', () => {
    const route = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const appearance = source('../../src/components/me/PageAppearanceSheet.tsx');

    expect(route).not.toContain("router.push('/settings/appearance')");
    expect(page).toContain('<PageAppearanceSheet');
    expect(appearance).toContain('presentationStyle="pageSheet"');
    expect(appearance).toContain('<PageLivePreview');
    expect(appearance).toContain('PAGE_TEMPLATE_IDS.map');
    expect(appearance).toContain('PAGE_FONT_IDS.map');
    expect(appearance).toContain('PAGE_BACKGROUND_IDS.map');
    expect(appearance).toContain('appearance.showBrand');
    expect(appearance).toContain('appearance.footerText');
  });

  it('provides persisted add, edit, enable, remove, and reorder controls for real blocks', () => {
    const sections = source('../../src/components/me/ProfileSectionsList.tsx');

    expect(sections).toContain('usePageDesignStore');
    expect(sections).toContain('<PageBlockPickerSheet');
    expect(sections).toContain('<PageBlockEditorSheet');
    expect(sections).toContain('setBlockVisible(block.id');
    expect(sections).toContain("moveBlock(block.id, 'up')");
    expect(sections).toContain("moveBlock(block.id, 'down')");
    expect(sections).toContain('removeBlock(block.id)');
    expect(sections).not.toContain('existing.has(entry.type)');
  });

  it('derives the dismissible Page alert from real cached stale checks', () => {
    const alert = source('../../src/components/me/PageLapsedCheckAlert.tsx');

    expect(alert).toContain('readCachedNostrResult()');
    expect(alert).toContain('readCachedAtprotoResult()');
    expect(alert).toContain("result.state === 'stale'");
    expect(alert).toContain('syncLapsedEvidence(evidence)');
    expect(alert).toContain('dismissLapsedAlert');
    expect(alert).toContain("t('pageDesign.publishedPage')");
    expect(alert).not.toContain("label: 'Published Page'");
  });

  it('applies custom backgrounds ahead of templates and localizes every appearance label', () => {
    const preview = source('../../src/components/me/PageLivePreview.tsx');
    const render = preview.slice(preview.indexOf('export function PageLivePreview'));
    const customBackground = render.indexOf('if (appearance.customBackground)');
    const gradientTemplate = render.indexOf("if (appearance.template === 'gradient'");

    expect(customBackground).toBeGreaterThanOrEqual(0);
    expect(customBackground).toBeLessThan(gradientTemplate);
    expect(en['pageDesign.colorPlaceholder']).toBe('#F8F4EA');
    expect(zhHant['pageDesign.colorPlaceholder']).toBe('#F8F4EA');
    expect(en['pageDesign.publishedPage']).toBe('Published Page');
    expect(zhHant['pageDesign.publishedPage']).toBe('已發布頁面');
  });

  it('makes every section style visibly distinct in the real-data preview', () => {
    const preview = source('../../src/components/me/PageLivePreview.tsx');

    for (const style of [
      'plain',
      'card',
      'grid',
      'carousel',
      'large-card',
      'embed',
      'thumbnail',
      'button',
      'slots',
    ]) {
      expect(preview).toContain(`case '${style}'`);
    }
    expect(preview).toContain('item.price');
    expect(preview).toContain('<PreviewBlockItems');
  });

  it('fails closed for Pro Page controls until an entitlement source exists', () => {
    const sections = source('../../src/components/me/ProfileSectionsList.tsx');
    const appearance = source('../../src/components/me/PageAppearanceSheet.tsx');
    const customColor = appearance.slice(
      appearance.indexOf('function CustomColorInput'),
      appearance.indexOf('function ControlSection'),
    );

    expect(sections).toContain("router.push('/settings/pro')");
    expect(sections).toContain('if (entry.pro) {');
    expect(sections).toContain('onProPress');
    expect(appearance).toContain("router.push('/settings/pro')");
    expect(appearance).toContain('if (index > 1) {');
    expect(appearance).toContain('onOpenPro');
    expect(appearance).toContain('editable={false}');
    expect(appearance).not.toContain('setAppearance({ showBrand })');
    expect(appearance).not.toContain('setAppearance({ footerText:');
    expect(customColor).not.toContain('onValidColor');
    expect(en['pageDesign.proControl']).toBe('Pro feature. View plan details; this app will not change your plan.');
    expect(zhHant['pageDesign.proControl']).toBe('Pro 功能。可查看方案內容，App 內不會變更方案。');
  });

  it('publishes Page controls into the signed profile and renders them beyond the editor sheet', () => {
    const route = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const sections = source('../../src/components/me/ProfileSectionsList.tsx');
    const store = source('../../src/profile/store.ts');
    const verified = source('../../src/components/scan/VerifiedProfileView.tsx');

    expect(route).toContain('adoptPublishedPage(record.page)');
    expect(store).toContain('readonly savePageDesign: (page: PublicPageDesign)');
    expect(store).toContain('savePageDesign: async (page)');
    expect(sections).toContain('savePageDesign(toPublicPageDesign(design))');
    expect(sections).toContain('pageDesign.publishChanges');
    expect(page).toContain('<PageLivePreview');
    expect(verified).toContain('record.page');
  });

  it('renders a signed Page as a full interactive visitor surface, not a compact editor sample', () => {
    const preview = source('../../src/components/me/PageLivePreview.tsx');
    const verified = source('../../src/components/scan/VerifiedProfileView.tsx');

    expect(preview).toContain("variant === 'public' ? items : items.slice(0, 3)");
    expect(preview).toContain('<ScrollView horizontal');
    expect(preview).toContain('accessibilityRole="link"');
    expect(preview).toContain('isRenderableLinkUrl(item.url)');
    expect(preview).toContain('item.media');
    expect(verified).toContain('variant="public"');
    expect(verified).not.toContain('{record.did}');
  });

  it('lets a signed Page own profile content while retaining the legacy profile fallback', () => {
    const verified = source('../../src/components/scan/VerifiedProfileView.tsx');
    const pageBranchStart = verified.indexOf('{record.page ? (');
    const legacyBranchStart = verified.indexOf(') : (', pageBranchStart);
    const pageBranch = verified.slice(pageBranchStart, legacyBranchStart);
    const legacyBranch = verified.slice(legacyBranchStart, verified.indexOf('function HandleBindingBadge'));

    expect(pageBranchStart).toBeGreaterThanOrEqual(0);
    expect(legacyBranchStart).toBeGreaterThan(pageBranchStart);
    expect(pageBranch).toContain('<PageLivePreview');
    expect(pageBranch).not.toContain('{record.displayName}');
    expect(pageBranch).not.toContain('record.bio.length > 0');
    expect(pageBranch).not.toContain('record.links.length > 0');
    expect(legacyBranch).toContain('{record.displayName}');
    expect(legacyBranch).toContain('record.bio.length > 0');
    expect(legacyBranch).toContain('record.links.length > 0');
    expect(legacyBranch).toContain('accessibilityLabel={link.label || link.url}');
  });

  it('keeps raw attestation and proof identifiers off the verified visitor Page', () => {
    const verified = source('../../src/components/scan/VerifiedProfileView.tsx');

    expect(verified).not.toContain('record.badges');
    expect(verified).not.toContain('verifiedPage.badgesHeader');
    expect(verified).not.toContain('verifiedPage.badgeDeclared');
    expect(verified).not.toContain('badge.type');
    expect(verified).not.toContain('badge.subject');
    expect(verified).not.toContain('binding.scheme');
    expect(verified).toContain("t('verifiedPage.signatureValid')");
    expect(verified).toContain('<HandleBindingBadge');
    expect(verified).toContain('binding.handle');
  });
});
