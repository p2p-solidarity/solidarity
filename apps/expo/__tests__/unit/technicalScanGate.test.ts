import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  isDeveloperOnlyDeepLinkKind,
  isDeveloperOnlyScanPayload,
} from '../../src/scan/technicalFlowGate';

const source = (relativePath: string): string =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('technical scan-flow gate', () => {
  it('recognises only OIDC payloads as developer-only scanner input', () => {
    for (const payload of [
      'openid4vp://authorize?client_id=https%3A%2F%2Fverifier.example&state=abc',
      'openid-vp://verify?vp_token=token&presentation_submission=submission',
      'openid-credential-offer://?credential_offer=%7B%7D',
    ]) {
      expect(isDeveloperOnlyScanPayload(payload)).toBe(true);
    }

    for (const payload of [
      'https://creds.id/alice#signed-page-fragment',
      'solidarity://card/f47ac10b-58cc-4372-a567-0e02b2c3d479',
      'BEGIN:VCARD\nVERSION:4.0\nFN:Ari\nEND:VCARD',
    ]) {
      expect(isDeveloperOnlyScanPayload(payload)).toBe(false);
    }
  });

  it('never hides a webSign request — the Page flow owns it for every user (07-plan P3)', () => {
    for (const payload of [
      'solidarity://websign?req=header.payload.signature',
      'https://creds.id/websign#req=header.payload.signature',
      'https://solidarity.gg/websign#req=header.payload.signature',
      'https://example.com/websign#req=header.payload.signature',
      'https://example.com/websign',
      'https://example.com/websign#signed-page-fragment',
      'https://example.com/websign#req=',
    ]) {
      expect(isDeveloperOnlyScanPayload(payload)).toBe(false);
    }
  });

  it('keeps only technical app deep-link kinds behind Developer Options', () => {
    expect(isDeveloperOnlyDeepLinkKind('oidc')).toBe(true);
    expect(isDeveloperOnlyDeepLinkKind('credentialOffer')).toBe(true);
    expect(isDeveloperOnlyDeepLinkKind('webSign')).toBe(false);
    expect(isDeveloperOnlyDeepLinkKind('verifiedProfile')).toBe(false);
    expect(isDeveloperOnlyDeepLinkKind('card')).toBe(false);
  });

  it('uses the shared gate before Scan can mount a technical flow, and guards the QR route', () => {
    const scan = source('../../app/scan/index.tsx');
    const shareQr = source('../../app/share/qr.tsx');
    const deepLinks = source('../../src/deeplink/router.ts');

    expect(scan).toContain('if (!developerMode && isDeveloperOnlyScanPayload(payload))');
    expect(scan).toContain("pushToast(t('scan.couldNotRead'), 'error');");
    expect(scan).toContain('developerMode ? (');
    expect(shareQr).toContain('if (!developerMode) return <Redirect href="/scan" />;');
    expect(deepLinks).toContain('if (!developerMode && isDeveloperOnlyDeepLinkKind(route.kind))');
  });

  it('keeps raw scan diagnostics inside Developer Mode and resumes normal scanning instead', () => {
    const scan = source('../../app/scan/index.tsx');

    // The result view is defense in depth: a future caller that accidentally
    // sets a raw route must still never render its payload for normal users.
    expect(scan).toContain("if (developerMode && route?.kind === 'raw')");

    // Unknown strings (URLs, JWTs, or arbitrary text) take the same unreadable
    // input path in normal mode: a human-friendly error, no raw route, and a
    // resumed camera session.
    expect(scan).toMatch(
      /const classifiedRoute = await classifyPayload\(payload, t\);\s*if \(!developerMode && classifiedRoute\.kind === 'raw'\) \{\s*pushToast\(t\('scan\.couldNotRead'\), 'error'\);\s*setRoute\(null\);\s*setIsScanning\(true\);\s*return;/s,
    );
  });
});
