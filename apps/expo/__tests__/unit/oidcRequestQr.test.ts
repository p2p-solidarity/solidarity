import { describe, expect, it } from 'bun:test';

import { buildOid4VpRequestUrl } from '../../src/oidc/requestQr';

describe('OID4VP request QR payload', () => {
  it('builds a verifier request URL instead of a business-card payload', () => {
    const url = buildOid4VpRequestUrl({
      nonce: 'abc123',
      state: 'state456',
      clientId: 'did:key:zVerifier',
    });

    expect(url.startsWith('BEGIN:VCARD')).toBe(false);
    expect(url.startsWith('openid4vp://authorize?')).toBe(true);
    expect(url).toContain('response_type=vp_token');
    expect(url).toContain('client_id=did%3Akey%3AzVerifier');
    expect(url).toContain('nonce=abc123');
    expect(url).toContain('state=state456');
    expect(url).toContain('response_mode=direct_post');
    expect(url).toContain('response_uri=solidarity%3A%2F%2Foidc-callback');
    expect(url).toContain('presentation_definition=');
    expect(decodeURIComponent(url)).toContain('"id":"default-request"');
    expect(decodeURIComponent(url)).toContain('"id":"business-card"');
  });
});
