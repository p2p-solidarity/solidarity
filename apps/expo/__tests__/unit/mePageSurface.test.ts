import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Page surface', () => {
  it('composes the real v2 Page in Hero, link zones, Attestations order', () => {
    const route = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const share = source('../../src/components/me/ProfileShareSurface.tsx');
    const shareContent = source('../../src/components/me/ProfileShareSheetContent.tsx');
    const badges = source('../../src/components/me/ProfileBadgeChips.tsx');
    const hero = source('../../src/components/me/ProfileHero.tsx');
    const shareSelection = source('../../src/components/me/useProfileShareSelection.ts');
    const links = source('../../src/components/me/ProfileLinksList.tsx');
    const motion = source('../../src/feedback/motion.ts');
    const verify = source('../../app/(tabs)/verify/index.tsx');

    expect(route).not.toContain('buildRuntimeSolidarityQrWire');
    expect(route).toContain('const linkVisibility = useProfileStore');
    expect(route).toContain('linkVisibility={linkVisibility}');
    expect(route).toContain('nostrPublishedJws');
    expect(route).toContain('publicRecord={published?.record ?? record}');
    expect(route).toContain("router.push('/settings/appearance')");
    expect(route).toContain("router.push('/settings')");
    expect(route).not.toContain('<MeNavBar');

    const heroIndex = page.indexOf('<ProfileHero');
    const linksIndex = page.indexOf('<ProfileLinksList');
    const sectionsIndex = page.indexOf('<ProfileSectionsList');
    const badgesIndex = page.indexOf('<ProfileBadgeChips');
    expect(heroIndex).toBeGreaterThan(-1);
    expect(linksIndex).toBeGreaterThan(heroIndex);
    expect(sectionsIndex).toBeGreaterThan(linksIndex);
    expect(badgesIndex).toBeGreaterThan(sectionsIndex);
    expect(page).toContain('linkVisibility={linkVisibility}');
    expect(page).not.toContain('IdentityCredentialRows');
    expect(page).not.toContain('<ProfileShareSurface');

    expect(hero).toContain('<ProfileShareSurface');
    expect(share).toContain("t('mePage.share')");
    expect(hero).toContain("t('mePage.appearance')");
    expect(hero).toContain("t('mePage.settings')");
    expect(hero).toContain('onPress={onEditAvatar}');
    expect(hero).not.toContain('<SfIcon name="pencil"');
    expect(hero).toContain('useWindowDimensions');
    expect(hero).toContain('pageHeaderLayout(width, fontScale)');
    expect(hero).toContain("layout === 'inline'");
    expect(hero).toContain("layout === 'stacked'");

    expect(links).toContain('pageLinkSections(links, linkVisibility)');
    expect(links).toContain("t('mePage.publicPage')");
    expect(links).toContain("t('mePage.cardOnly')");
    expect(links).not.toContain("renderSection(t('mePage.hidden')");
    expect(links).toContain("t('mePage.reviewHidden')");
    expect(links).toContain("t('mePage.noLinks')");
    expect(links).toContain('if (links.length === 0)');
    expect(links).toContain('accessibilityRole="header"');
    expect(page).toContain('accessibilityRole="header"');
    expect(hero).toContain('<ProfileInlineQr');
    expect(links.match(/onPress=\{onAddFirstLink\}/gu)).toHaveLength(1);
    expect(links).toContain('linkIconNameFor');

    const publicHeadingIndex = links.indexOf("t('mePage.publicPage')");
    const cardOnlyHeadingIndex = links.indexOf("t('mePage.cardOnly')");
    expect(publicHeadingIndex).toBeGreaterThan(-1);
    expect(cardOnlyHeadingIndex).toBeGreaterThan(publicHeadingIndex);
    expect(page).toContain('linkCount={record.links.length}');
    expect(badges).toContain("t('mePage.addAttestation')");

    expect(badges).toContain('verifyAtprotoBindingDual(record, publicRecord');
    expect(badges).toContain('verifyNostrBinding');
    expect(page).toContain('nostrUploaded={nostrShortUrlReady}');
    expect(badges).toContain('readonly nostrUploaded: boolean');
    expect(badges).toMatch(/nostrUploaded\s+\? record\.alsoKnownAs/u);
    expect(badges).toContain('verifyAtprotoBinding');
    expect(badges).toContain('badgeRecoveryActions');
    expect(badges).toContain('invalidateCachedNostrResult');
    expect(badges).toContain('invalidateCachedAtprotoResult');
    expect(badges).toContain('publishToNostr(DEFAULT_RELAYS)');
    expect(badges).toContain("router.push('/verify/bluesky')");
    expect(badges).toContain('atprotoBindingIO');
    expect(badges).toContain('verifyHttpsOwnership');
    expect(badges).toContain("credential.type.toLowerCase() === 'passport'");
    expect(badges).toContain('credentialTrustDisplayFor');
    expect(badges).toContain('credentialTrustDisplayFor(detail).level');
    expect(badges).toContain(": 'L1'");
    expect(badges).toContain("icon: 'checkmark.seal.fill', color: Colors.terminalGreen");
    expect(badges).toContain("icon: 'checkmark.seal', color: Colors.warning");
    expect(badges).toContain("icon: 'exclamationmark.triangle', color: Colors.text3");
    expect(verify).not.toContain('BadgeBindingsSection');
    expect(verify).not.toContain("router.push('/verify/nostr')");

    expect(share).toContain('generateQrPng');
    expect(share).toContain('useProfileShareSelection');
    expect(share).not.toContain('onOpenShareSettings');
    expect(share).not.toContain("t('mePage.shareYourPage')");
    expect(share).not.toContain('ShareFieldsRow');
    expect(share).not.toContain('buildRuntimeSolidarityQrWire');
    expect(share).not.toContain("setShareState({ kind: 'loading' })");
    expect(share).toContain('setSelectedKind(candidate.kind)');
    expect(shareSelection).toContain('useSyncExternalStore');
    expect(shareSelection).toContain('setTimeout');
    expect(shareContent).toContain('onSelect(candidate)');
    expect(shareContent).toContain("t('meShare.useFormat'");
    expect([route, page, hero, links, badges].join('\n')).not.toContain('generateQrPng');
    expect(share).toContain('export function ProfileInlineQr');
    expect(share).toContain("shareState.kind === 'error'");
    expect(share).toContain('setInlineRetryNonce');
    expect(share).toContain("t('meShare.modelError')");

    expect(motion).toContain('STAGGER_MS = 40');
    expect(page).toContain('const ENTRANCE_DURATION_MS = 240');
    expect(page).toContain('STAGGER_MS * 2');
    expect(page).toContain('STAGGER_MS * 3');
    expect(share).toContain('const QR_SHEET_DURATION_MS = 240');
    expect(share).toContain('Easing.out');
    expect(share).toContain('scale: 0.97');
    expect(share).toContain('shareQrImage');
    expect(shareContent).toContain("t('meShare.shareQrImage')");
    expect(badges).toContain('const BADGE_CROSSFADE_MS = 200');

    const pageSurfaceSource = [page, share, badges, hero, links].join('\n');
    expect(pageSurfaceSource).not.toMatch(/#[0-9a-f]{3,8}\b/iu);
  });

  it('uses the exact human-facing Page section and action labels', () => {
    expect(zhHant['mePage.publicPage']).toBe('公開頁');
    expect(zhHant['mePage.cardOnly']).toBe('名片才有');
    expect(zhHant['mePage.hidden']).toBe('隱藏');
    expect(zhHant['mePage.attestations']).toBe('證明');
    expect(zhHant['mePage.share']).toBe('分享');
    expect(zhHant['mePage.appearance']).toBe('外觀');
    expect(zhHant['mePage.settings']).toBe('設定');
    expect(en['mePage.publicPage']).toBe('Public Page');
    expect(en['mePage.cardOnly']).toBe('Card Only');
    expect(en['mePage.hidden']).toBe('Hidden');
    expect(en['mePage.attestations']).toBe('Attestations');
    expect(en['mePage.share']).toBe('Share');
    expect(en['mePage.appearance']).toBe('Appearance');
    expect(en['mePage.settings']).toBe('Settings');
  });

  it('uses the current human-facing Card Fields copy in both locales', () => {
    expect(en['mePage.shareFields']).toBe('Card Fields');
    expect(zhHant['mePage.shareFields']).toBe('名片欄位');
  });
});
