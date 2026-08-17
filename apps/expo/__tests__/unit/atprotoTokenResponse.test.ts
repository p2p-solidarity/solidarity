/**
 * atproto OAuth — token-response parsing + expiry math (task A6.1).
 *
 * TS module under test: apps/expo/src/atproto/tokenResponse.ts
 */
import { describe, expect, it } from 'bun:test';

import { parseAtprotoTokenResponse } from '@/atproto/tokenResponse';

const VALID = {
  access_token: 'access-abc',
  token_type: 'DPoP',
  refresh_token: 'refresh-abc',
  sub: 'did:plc:examplefakedid1234',
  scope: 'atproto transition:generic',
  expires_in: 300,
};

describe('parseAtprotoTokenResponse', () => {
  it('parses a valid response and computes expiresAtMs from an injected nowMs', () => {
    const r = parseAtprotoTokenResponse(VALID, 1_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.accessToken).toBe('access-abc');
    expect(r.value.refreshToken).toBe('refresh-abc');
    expect(r.value.sub).toBe('did:plc:examplefakedid1234');
    expect(r.value.scope).toBe('atproto transition:generic');
    expect(r.value.expiresAtMs).toBe(1_000_000 + 300_000);
  });

  it('accepts token_type case-insensitively (dpop / DPOP / DPoP)', () => {
    for (const token_type of ['dpop', 'DPOP', 'DPoP']) {
      const r = parseAtprotoTokenResponse({ ...VALID, token_type });
      expect(r.ok).toBe(true);
    }
  });

  it('rejects a non-object response', () => {
    expect(parseAtprotoTokenResponse(null).ok).toBe(false);
    expect(parseAtprotoTokenResponse('not json').ok).toBe(false);
    expect(parseAtprotoTokenResponse([1, 2, 3]).ok).toBe(false);
  });

  it('rejects a missing access_token', () => {
    const { access_token: _drop, ...rest } = VALID;
    const r = parseAtprotoTokenResponse(rest);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('access_token');
  });

  it('rejects a bearer token_type — atproto mandates DPoP-bound tokens', () => {
    const r = parseAtprotoTokenResponse({ ...VALID, token_type: 'Bearer' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('DPoP');
  });

  it('rejects a missing refresh_token', () => {
    const { refresh_token: _drop, ...rest } = VALID;
    const r = parseAtprotoTokenResponse(rest);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('refresh_token');
  });

  it('rejects a missing or non-DID sub', () => {
    expect(parseAtprotoTokenResponse({ ...VALID, sub: undefined }).ok).toBe(false);
    const r = parseAtprotoTokenResponse({ ...VALID, sub: 'not-a-did' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('sub');
  });

  it('rejects a scope missing "atproto"', () => {
    const r = parseAtprotoTokenResponse({ ...VALID, scope: 'transition:generic' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('atproto');
  });

  it('rejects a missing scope field entirely (spec: reject if scope field absent)', () => {
    const { scope: _drop, ...rest } = VALID;
    expect(parseAtprotoTokenResponse(rest).ok).toBe(false);
  });

  it('rejects a missing/invalid expires_in', () => {
    expect(parseAtprotoTokenResponse({ ...VALID, expires_in: undefined }).ok).toBe(false);
    expect(parseAtprotoTokenResponse({ ...VALID, expires_in: 0 }).ok).toBe(false);
    expect(parseAtprotoTokenResponse({ ...VALID, expires_in: -5 }).ok).toBe(false);
    expect(parseAtprotoTokenResponse({ ...VALID, expires_in: 'soon' }).ok).toBe(false);
  });

  it('defaults nowMs to Date.now() when not injected', () => {
    const before = Date.now();
    const r = parseAtprotoTokenResponse(VALID);
    const after = Date.now();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.expiresAtMs).toBeGreaterThanOrEqual(before + 300_000);
    expect(r.value.expiresAtMs).toBeLessThanOrEqual(after + 300_000);
  });
});
