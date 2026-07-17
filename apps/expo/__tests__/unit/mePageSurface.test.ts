import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('Me public-page surface', () => {
  it('keeps one profile QR, both live badge verifiers, and the binding entry out of Verify', () => {
    const route = source('../../app/(tabs)/me/index.tsx');
    const page = source('../../src/components/me/MeProfilePage.tsx');
    const share = source('../../src/components/me/ProfileShareSurface.tsx');
    const badges = source('../../src/components/me/ProfileBadgeChips.tsx');
    const hero = source('../../src/components/me/ProfileHero.tsx');
    const links = source('../../src/components/me/ProfileLinksList.tsx');
    const identityRows = source('../../src/components/me/IdentityCredentialRows.tsx');
    const motion = source('../../src/feedback/motion.ts');
    const verify = source('../../app/(tabs)/verify/index.tsx');

    expect(route).not.toContain('buildRuntimeSolidarityQrWire');
    expect(page).toContain('ProfileShareSurface');
    expect(share).toContain('buildProfileShareModel');
    expect(share).not.toContain('buildRuntimeSolidarityQrWire');
    expect(badges).toContain('verifyNostrBinding');
    expect(badges).toContain('verifyAtprotoBinding');
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
    expect(badges).toContain('const BADGE_CROSSFADE_MS = 200');

    const meSurfaceSource = [page, share, badges, hero, links, identityRows].join('\n');
    expect(meSurfaceSource).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
