import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import en from '../../src/i18n/locales/en.json';
import zhHant from '../../src/i18n/locales/zh-Hant.json';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Me public-page surface', () => {
  it('keeps one profile QR, both live badge verifiers, and the binding entry out of Verify', () => {
    const route = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const share = source('../../src/components/me/ProfileShareSurface.tsx');
    const shareContent = source('../../src/components/me/ProfileShareSheetContent.tsx');
    const badges = source('../../src/components/me/ProfileBadgeChips.tsx');
    const hero = source('../../src/components/me/ProfileHero.tsx');
    const shareSelection = source('../../src/components/me/useProfileShareSelection.ts');
    const links = source('../../src/components/me/ProfileLinksList.tsx');
    const identityRows = source('../../src/components/me/IdentityCredentialRows.tsx');
    const motion = source('../../src/feedback/motion.ts');
    const verify = source('../../app/(tabs)/verify/index.tsx');

    expect(route).not.toContain('buildRuntimeSolidarityQrWire');
    expect(page).toContain('ProfileShareSurface');
    expect(route).toContain('nostrPublishedJws');
    expect(route).toContain('publicRecord={published?.record ?? record}');
    expect(badges).toContain('verifyAtprotoBindingDual(record, publicRecord');
    expect(hero).toContain('useProfileShareSelection');
    expect(share).toContain('useProfileShareSelection');
    expect(shareSelection).toContain('useSyncExternalStore');
    expect(shareSelection).toContain('setTimeout');
    expect(share).not.toContain("setShareState({ kind: 'loading' })");
    expect(share).toContain('setSelectedKind(candidate.kind)');
    expect(shareContent).toContain('onSelect(candidate)');
    expect(shareContent).toContain("t('meShare.useFormat'");
    expect(share).toContain('ShareFieldsRow');
    expect(route).toContain("router.push('/settings/share-settings')");
    expect(share).not.toContain('buildRuntimeSolidarityQrWire');
    expect(badges).toContain('verifyNostrBinding');
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
    expect(badges).toContain(": 'L1'");
    expect(links).toContain('linkIconNameFor');
    expect(badges).toContain("icon: 'checkmark.seal.fill', color: Colors.terminalGreen");
    expect(badges).toContain("icon: 'checkmark.seal', color: Colors.warning");
    expect(badges).toContain("icon: 'exclamationmark.triangle', color: Colors.text3");
    expect(verify).not.toContain('BadgeBindingsSection');
    expect(verify).not.toContain("router.push('/verify/nostr')");

    expect(motion).toContain('STAGGER_MS = 40');
    expect(page).toContain('const ENTRANCE_DURATION_MS = 240');
    expect(page).toContain('STAGGER_MS * 2');
    expect(page).not.toContain('STAGGER_MS * 3');
    expect(share).toContain('const QR_SHEET_DURATION_MS = 240');
    expect(share).toContain('Easing.out');
    expect(share).toContain('scale: 0.97');
    expect(share).toContain('shareQrImage');
    expect(shareContent).toContain("t('meShare.shareQrImage')");
    expect(badges).toContain('const BADGE_CROSSFADE_MS = 200');

    const meSurfaceSource = [page, share, badges, hero, links, identityRows].join('\n');
    expect(meSurfaceSource).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('labels the retained legacy business-card controls honestly in both locales', () => {
    expect(en['mePage.shareFields']).toBe('Business-card fields (legacy)');
    expect(zhHant['mePage.shareFields']).toBe('名片分享欄位（舊版名片）');
  });
});
