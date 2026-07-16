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

  it('parses a https://solidarity.gg/#nostr:<npub> short-pointer link', () => {
    const npub = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
    const r = parseDeepLink(`https://solidarity.gg/#nostr:${npub}`);
    expect(r.kind).toBe('verifiedPointer');
    if (r.kind === 'verifiedPointer') expect(r.npub).toBe(npub);
  });

  it('does not misread a #nostr: prefix with a non-npub tail as a fragment — falls to unknown', () => {
    expect(parseDeepLink('https://solidarity.gg/#nostr:not-an-npub').kind).toBe('unknown');
    expect(parseDeepLink('https://solidarity.gg/#nostr:').kind).toBe('unknown');
    // An overlong tail (DoS guard) is also rejected.
    expect(parseDeepLink(`https://solidarity.gg/#nostr:npub1${'q'.repeat(200)}`).kind).toBe('unknown');
  });

  it('still prefers the /c/<uuid> card route over a Verified Page fragment on the same host', () => {
    const r = parseDeepLink('https://solidarity.gg/c/f47ac10b-58cc-4372-a567-0e02b2c3d479#ignored');
    expect(r.kind).toBe('card');
  });

  // Task A5.4 — `solidarity://pear/<did>` into the Pear requester flow. A
  // real did:key so `isValidPearDid`'s `resolveDidKey` round-trip actually
  // succeeds (base58 + P-256 multicodec check), not just a plausible-looking
  // string.
  const REAL_DID = 'did:key:zDnaeuchQNqLi4x1P85fs3QsiMPahCH2snwHU4SaV6MQnan2Q';

  it('parses a solidarity://pear/<did> link', () => {
    const r = parseDeepLink(`solidarity://pear/${REAL_DID}`);
    expect(r.kind).toBe('pear');
    if (r.kind === 'pear') {
      expect(r.did).toBe(REAL_DID);
    }
  });

  it('parses a https://solidarity.gg/pear/<did> universal link', () => {
    const r = parseDeepLink(`https://solidarity.gg/pear/${REAL_DID}`);
    expect(r.kind).toBe('pear');
    if (r.kind === 'pear') {
      expect(r.did).toBe(REAL_DID);
    }
  });

  it('rejects a pear link with no did, never throwing', () => {
    expect(() => parseDeepLink('solidarity://pear/')).not.toThrow();
    expect(parseDeepLink('solidarity://pear/').kind).toBe('unknown');
    expect(parseDeepLink('solidarity://pear').kind).toBe('unknown');
  });

  it('rejects a pear link with a malformed did, never throwing', () => {
    expect(() => parseDeepLink('solidarity://pear/not-a-did')).not.toThrow();
    expect(parseDeepLink('solidarity://pear/not-a-did').kind).toBe('unknown');
    expect(parseDeepLink('solidarity://pear/did:key:zNotBase58!!!').kind).toBe('unknown');
  });

  it('rejects a pear link with path traversal / extra segments, never throwing', () => {
    expect(parseDeepLink(`solidarity://pear/${REAL_DID}/extra`).kind).toBe('unknown');
    expect(parseDeepLink('solidarity://pear/../../etc/passwd').kind).toBe('unknown');
    expect(() => parseDeepLink(`solidarity://pear/${REAL_DID}/../../etc`)).not.toThrow();
  });

  it('rejects hostile injection-shaped input in the pear path, never throwing', () => {
    expect(() =>
      parseDeepLink('solidarity://pear/%3Cscript%3Ealert(1)%3C%2Fscript%3E')
    ).not.toThrow();
    expect(parseDeepLink('solidarity://pear/%3Cscript%3Ealert(1)%3C%2Fscript%3E').kind).toBe(
      'unknown'
    );
  });

  it('rejects a https pear link with a malformed did or extra segments', () => {
    expect(parseDeepLink('https://solidarity.gg/pear/not-a-did').kind).toBe('unknown');
    expect(parseDeepLink(`https://solidarity.gg/pear/${REAL_DID}/extra`).kind).toBe('unknown');
    expect(parseDeepLink('https://solidarity.gg/pear/').kind).toBe('unknown');
  });

  // Code-review Finding 1 (Task A5.4 follow-up): `isVerifiedDomain`/
  // `TRUSTED_HOSTS` also allowlists third-party identity hosts
  // (apple.com/google.com/microsoft.com/github.com/linkedin.com) for a
  // DIFFERENT purpose (OIDC/domain verification). The `pear` and `card`
  // universal-link routes must only fire on OUR OWN product hosts
  // (solidarity.gg / airmeishi.app) — not on every host that list trusts
  // for something else entirely.
  it('does NOT route a pear link on a trusted-but-non-product host (github.com)', () => {
    expect(parseDeepLink(`https://github.com/pear/${REAL_DID}`).kind).toBe('unknown');
  });

  it('does NOT route a card link on a trusted-but-non-product host (github.com)', () => {
    expect(parseDeepLink('https://github.com/c/f47ac10b-58cc-4372-a567-0e02b2c3d479').kind).toBe(
      'unknown'
    );
  });

  it('does NOT route pear/card links on the other allowlisted identity hosts', () => {
    for (const host of ['apple.com', 'google.com', 'microsoft.com', 'linkedin.com']) {
      expect(parseDeepLink(`https://${host}/pear/${REAL_DID}`).kind).toBe('unknown');
      expect(
        parseDeepLink(`https://${host}/c/f47ac10b-58cc-4372-a567-0e02b2c3d479`).kind
      ).toBe('unknown');
    }
  });

  it('still routes pear/card links on both product hosts', () => {
    for (const host of ['solidarity.gg', 'airmeishi.app']) {
      expect(parseDeepLink(`https://${host}/pear/${REAL_DID}`).kind).toBe('pear');
      expect(
        parseDeepLink(`https://${host}/c/f47ac10b-58cc-4372-a567-0e02b2c3d479`).kind
      ).toBe('card');
    }
  });

  // Finding 2 (minor, pinned): unpinned edge cases named in review.
  it('rejects an absurdly-long did string without crashing or hanging', () => {
    const huge = `did:key:z${'1'.repeat(100_000)}`;
    expect(() => parseDeepLink(`solidarity://pear/${huge}`)).not.toThrow();
    expect(parseDeepLink(`solidarity://pear/${huge}`).kind).toBe('unknown');
    expect(() => parseDeepLink(`https://solidarity.gg/pear/${huge}`)).not.toThrow();
    expect(parseDeepLink(`https://solidarity.gg/pear/${huge}`).kind).toBe('unknown');
  });

  it('extracts the did cleanly from a solidarity://pear/<did>?query link, ignoring the query string', () => {
    const r = parseDeepLink(`solidarity://pear/${REAL_DID}?evil=1&other=2`);
    expect(r.kind).toBe('pear');
    if (r.kind === 'pear') {
      expect(r.did).toBe(REAL_DID);
    }
  });
});
