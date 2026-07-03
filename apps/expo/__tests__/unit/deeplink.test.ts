/**
 * Deep-link parser — pure URL → route table.
 */
import { describe, expect, it } from 'bun:test';

import { parseDeepLink } from '../../src/deeplink/parser';

describe('parseDeepLink', () => {
  it('parses a solidarity:// card link', () => {
    const r = parseDeepLink('solidarity://card/f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(r.kind).toBe('card');
    if (r.kind === 'card') {
      expect(r.cardId).toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    }
  });

  it('parses a https://solidarity.gg/c/<uuid> universal link', () => {
    const r = parseDeepLink('https://solidarity.gg/c/f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(r.kind).toBe('card');
  });

  it('parses an openid4vp:// auth request', () => {
    const r = parseDeepLink('openid4vp://?client_id=https%3A%2F%2Fverifier.example&state=abc');
    expect(r.kind).toBe('oidc');
    if (r.kind === 'oidc') {
      expect(r.query).toContain('client_id=');
    }
  });

  it('parses a group invite', () => {
    const r = parseDeepLink('solidarity://group/eyJhbGciOiJFUzI1NiJ9.abc');
    expect(r.kind).toBe('groupInvite');
  });

  it('parses a credential offer', () => {
    const r = parseDeepLink('openid-credential-offer://?credential_offer=foo');
    expect(r.kind).toBe('credentialOffer');
  });

  it('treats an empty credential-offer URL as unknown (stale Android launch intent)', () => {
    // Android `singleTask` replays the launch intent on every resume; a bare
    // `openid-credential-offer://` would push us into the import flow with no
    // payload every cold start.
    expect(parseDeepLink('openid-credential-offer://').kind).toBe('unknown');
    expect(parseDeepLink('openid-credential-offer://?').kind).toBe('unknown');
  });

  it('treats credential-offer URLs without an offer payload as unknown', () => {
    expect(parseDeepLink('openid-credential-offer://?url=exp%3A%2F%2F127.0.0.1').kind).toBe(
      'unknown'
    );
  });

  it('treats an empty openid4vp URL as unknown (stale Android launch intent)', () => {
    expect(parseDeepLink('openid4vp://').kind).toBe('unknown');
    expect(parseDeepLink('openid-vp://?').kind).toBe('unknown');
  });

  it('returns unknown for unrecognised input', () => {
    expect(parseDeepLink('not a url').kind).toBe('unknown');
    expect(parseDeepLink('https://example.com/foo').kind).toBe('unknown');
  });

  it('parses a https://solidarity.gg/#<fragment> Verified Page link', () => {
    const r = parseDeepLink('https://solidarity.gg/#eyJhbGciOiJFUzI1NiJ9');
    expect(r.kind).toBe('verifiedProfile');
    if (r.kind === 'verifiedProfile') {
      expect(r.fragment).toBe('eyJhbGciOiJFUzI1NiJ9');
    }
  });

  it('treats a verified-domain https link with no hash as unknown, not verifiedProfile', () => {
    expect(parseDeepLink('https://solidarity.gg/').kind).toBe('unknown');
    expect(parseDeepLink('https://solidarity.gg').kind).toBe('unknown');
  });

  it('still prefers the /c/<uuid> card route over a Verified Page fragment on the same host', () => {
    const r = parseDeepLink('https://solidarity.gg/c/f47ac10b-58cc-4372-a567-0e02b2c3d479#ignored');
    expect(r.kind).toBe('card');
  });
});
