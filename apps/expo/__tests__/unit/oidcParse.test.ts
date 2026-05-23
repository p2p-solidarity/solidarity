/**
 * OIDC auth-request parser — happy path + rejection.
 */
import { describe, expect, it } from 'bun:test';

import { parseOidcRequest } from '../../src/oidc/parseAuthRequest';

const validUrl =
  'openid4vp://?client_id=https%3A%2F%2Fverifier.example' +
  '&redirect_uri=https%3A%2F%2Fverifier.example%2Fcb' +
  '&state=abc123' +
  '&nonce=xyz789' +
  '&scope=age_over_18+preferences' +
  '&code_challenge=AAAA' +
  '&code_challenge_method=S256';

describe('parseOidcRequest', () => {
  it('parses a valid openid4vp queryparam URL', () => {
    const parsed = parseOidcRequest(validUrl);
    expect(parsed.source).toBe('queryparams');
    expect(parsed.request.client_id).toBe('https://verifier.example');
    expect(parsed.request.state).toBe('abc123');
    expect(parsed.request.scope).toEqual(['age_over_18', 'preferences']);
    expect(parsed.request.code_challenge_method).toBe('S256');
  });

  it('rejects unsupported schemes', () => {
    expect(() => parseOidcRequest('weird://abc')).toThrow();
  });

  it('rejects requests missing required fields', () => {
    expect(() => parseOidcRequest('openid4vp://?state=abc')).toThrow();
  });

  it('inlines a JSON presentation_definition queryparam', () => {
    const pd = encodeURIComponent(
      JSON.stringify({ id: 'pd-1', input_descriptors: [{ id: 'name' }] })
    );
    const parsed = parseOidcRequest(
      `${validUrl}&presentation_definition=${pd}`
    );
    expect(parsed.request.presentation_definition?.id).toBe('pd-1');
    expect(parsed.request.presentation_definition?.input_descriptors.length).toBe(1);
  });
});
