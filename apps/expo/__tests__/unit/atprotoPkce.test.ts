/**
 * atproto OAuth — PKCE (task A6.1).
 *
 * TS module under test: apps/expo/src/atproto/pkce.ts
 *
 * Pins: RFC 7636 S256 challenge = base64url(sha256(verifier)); verifier
 * length/charset within spec bounds; freshness (no reuse across calls).
 */
import { describe, expect, it } from 'bun:test';
import { sha256 } from '@noble/hashes/sha2.js';

import { generatePkce } from '@/atproto/pkce';

function base64UrlEncodeRef(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

describe('generatePkce', () => {
  it('codeChallengeMethod is always S256 (plain is disallowed by the atproto profile)', () => {
    expect(generatePkce().codeChallengeMethod).toBe('S256');
  });

  it('codeVerifier is within RFC 7636 length bounds (43-128 chars) and unreserved charset', () => {
    const { codeVerifier } = generatePkce();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(/^[A-Za-z0-9._~-]+$/u.test(codeVerifier)).toBe(true);
  });

  it('codeChallenge = base64url(sha256(codeVerifier utf8 bytes)) — independently recomputed', () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const expected = base64UrlEncodeRef(sha256(new TextEncoder().encode(codeVerifier)));
    expect(codeChallenge).toBe(expected);
  });

  it('every call produces a fresh, non-repeating verifier', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      seen.add(generatePkce().codeVerifier);
    }
    expect(seen.size).toBe(50);
  });

  it('codeChallenge never equals codeVerifier (would indicate a no-op hash)', () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    expect(codeChallenge).not.toBe(codeVerifier);
  });
});
