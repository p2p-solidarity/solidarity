/**
 * atproto OAuth — DPoP proof construction (task A6.1, RFC 9449).
 *
 * TS module under test: apps/expo/src/atproto/dpop.ts
 *
 * Pins: header shape (`typ: 'dpop+jwt'`, minimal public `jwk`, no `d`),
 * payload shape (`jti`/`htm`/`htu`/`iat`, optional `nonce`/`ath`),
 * signature verifies against the embedded `jwk` (round-trips through
 * `@solidarity/shared`'s `verifyJwtEs256` — the same primitive a real
 * Authorization Server's verification path is functionally equivalent
 * to), and per-call freshness (`jti` never repeats).
 */
import { describe, expect, it } from 'bun:test';
import { base64UrlEncode, sha256Bytes, verifyJwtEs256 } from '@solidarity/shared';

import { buildDpopProof, generateDpopKeyPair } from '@/atproto/dpop';

describe('generateDpopKeyPair', () => {
  it('produces a P-256 keypair with a well-formed public JWK', () => {
    const kp = generateDpopKeyPair();
    expect(kp.privateKey.length).toBe(32);
    expect(kp.publicJwk.kty).toBe('EC');
    expect(kp.publicJwk.crv).toBe('P-256');
    expect(kp.publicJwk.alg).toBe('ES256');
  });

  it('generates a fresh keypair every call', () => {
    const a = generateDpopKeyPair();
    const b = generateDpopKeyPair();
    expect(a.publicJwk.x).not.toBe(b.publicJwk.x);
  });
});

describe('buildDpopProof', () => {
  it('header is exactly {typ, alg, jwk} with jwk trimmed to kty/crv/x/y (no d, no alg/use inside jwk)', () => {
    const kp = generateDpopKeyPair();
    const proof = buildDpopProof(kp, { htm: 'post', htu: 'https://pds.example/xrpc/foo' });
    const [headerB64] = proof.split('.');
    const header = JSON.parse(atob((headerB64 ?? '').replace(/-/gu, '+').replace(/_/gu, '/'))) as Record<
      string,
      unknown
    >;
    expect(header['typ']).toBe('dpop+jwt');
    expect(header['alg']).toBe('ES256');
    const jwk = header['jwk'] as Record<string, unknown>;
    expect(Object.keys(jwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
    expect(jwk['kty']).toBe('EC');
    expect(jwk['crv']).toBe('P-256');
    expect(jwk['x']).toBe(kp.publicJwk.x);
    expect(jwk['y']).toBe(kp.publicJwk.y);
  });

  it('htm is upper-cased regardless of input case', () => {
    const kp = generateDpopKeyPair();
    const proof = buildDpopProof(kp, { htm: 'post', htu: 'https://pds.example/xrpc/foo' });
    const { payload } = verifyJwtEs256<{ htm: string }>(proof, kp.publicJwk);
    expect(payload.htm).toBe('POST');
  });

  it('payload carries htu verbatim and a recent iat, and verifies against the embedded jwk', () => {
    const kp = generateDpopKeyPair();
    const beforeSec = Math.floor(Date.now() / 1000);
    const proof = buildDpopProof(kp, { htm: 'POST', htu: 'https://pds.example/xrpc/foo' });
    const afterSec = Math.floor(Date.now() / 1000);
    const { payload } = verifyJwtEs256<{ htu: string; iat: number; jti: string }>(proof, kp.publicJwk);
    expect(payload.htu).toBe('https://pds.example/xrpc/foo');
    expect(payload.iat).toBeGreaterThanOrEqual(beforeSec);
    expect(payload.iat).toBeLessThanOrEqual(afterSec);
    expect(typeof payload.jti).toBe('string');
    expect(payload.jti.length).toBeGreaterThan(0);
  });

  it('strips query and fragment from htu before signing (RFC 9449 §4.2)', () => {
    const kp = generateDpopKeyPair();
    const proof = buildDpopProof(kp, { htm: 'POST', htu: 'https://pds.example/xrpc/foo?x=1#f' });
    const { payload } = verifyJwtEs256<{ htu: string }>(proof, kp.publicJwk);
    expect(payload.htu).toBe('https://pds.example/xrpc/foo');
  });

  it('omits nonce/ath when not provided', () => {
    const kp = generateDpopKeyPair();
    const proof = buildDpopProof(kp, { htm: 'POST', htu: 'https://pds.example/xrpc/foo' });
    const { payload } = verifyJwtEs256<Record<string, unknown>>(proof, kp.publicJwk);
    expect('nonce' in payload).toBe(false);
    expect('ath' in payload).toBe(false);
  });

  it('includes nonce verbatim when provided', () => {
    const kp = generateDpopKeyPair();
    const proof = buildDpopProof(kp, {
      htm: 'POST',
      htu: 'https://pds.example/xrpc/foo',
      nonce: 'server-nonce-abc',
    });
    const { payload } = verifyJwtEs256<{ nonce: string }>(proof, kp.publicJwk);
    expect(payload.nonce).toBe('server-nonce-abc');
  });

  it('ath = base64url(sha256(accessToken)) when accessToken is provided', () => {
    const kp = generateDpopKeyPair();
    const accessToken = 'a-real-access-token-value';
    const proof = buildDpopProof(kp, { htm: 'GET', htu: 'https://pds.example/xrpc/foo', accessToken });
    const { payload } = verifyJwtEs256<{ ath: string }>(proof, kp.publicJwk);
    expect(payload.ath).toBe(base64UrlEncode(sha256Bytes(accessToken)));
  });

  it('jti is unique across calls (never cached/reused)', () => {
    const kp = generateDpopKeyPair();
    const jtis = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const proof = buildDpopProof(kp, { htm: 'POST', htu: 'https://pds.example/xrpc/foo' });
      const { payload } = verifyJwtEs256<{ jti: string }>(proof, kp.publicJwk);
      jtis.add(payload.jti);
    }
    expect(jtis.size).toBe(20);
  });

  it('a proof signed by one key does not verify against a different key\'s jwk', () => {
    const kpA = generateDpopKeyPair();
    const kpB = generateDpopKeyPair();
    const proof = buildDpopProof(kpA, { htm: 'POST', htu: 'https://pds.example/xrpc/foo' });
    expect(() => verifyJwtEs256(proof, kpB.publicJwk)).toThrow();
  });
});
