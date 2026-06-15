/**
 * Unit tests for @solidarity/shared/identity (P-256 keypair, did:key, JWT).
 *
 * Round-trip oriented: any encoded artefact must decode back to the same
 * input. Cross-impl parity lives in __tests__/parity/identity.parity.test.ts.
 */
import { describe, expect, it } from 'bun:test';

import {
  base64UrlDecode,
  base64UrlEncode,
  bytesToHex,
  bytesToUtf8,
  didKeyFromJwk,
  didKeyFromPublicKey,
  generateP256KeyPair,
  hexToBytes,
  jwkToPublicKey,
  publicKeyFromPrivate,
  publicKeyToJwk,
  resolveDidKey,
  signJwtEs256,
  utf8ToBytes,
  verifyJwtEs256,
} from '@solidarity/shared';

describe('P-256 keypair', () => {
  it('publicKeyFromPrivate matches generate output', () => {
    const kp = generateP256KeyPair();
    const derived = publicKeyFromPrivate(kp.privateKey);
    expect(bytesToHex(derived)).toBe(bytesToHex(kp.publicKey));
  });

  it('JWK round-trip preserves the point', () => {
    const kp = generateP256KeyPair();
    const jwk = publicKeyToJwk(kp.publicKey);
    const back = jwkToPublicKey(jwk);
    expect(bytesToHex(back)).toBe(bytesToHex(kp.publicKey));
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    expect(jwk.alg).toBe('ES256');
  });
});

describe('did:key (P-256)', () => {
  it('round-trips through encode + resolve', () => {
    const kp = generateP256KeyPair();
    const jwk = publicKeyToJwk(kp.publicKey);
    const did = didKeyFromJwk(jwk);
    expect(did.startsWith('did:key:z')).toBe(true);
    const resolved = resolveDidKey(did);
    expect(resolved.x).toBe(jwk.x);
    expect(resolved.y).toBe(jwk.y);
  });

  it('derives same DID whether from pubkey or JWK', () => {
    const kp = generateP256KeyPair();
    const fromPoint = didKeyFromPublicKey(kp.publicKey);
    const fromJwk = didKeyFromJwk(publicKeyToJwk(kp.publicKey));
    expect(fromPoint).toBe(fromJwk);
  });

  it('rejects malformed DIDs', () => {
    expect(() => resolveDidKey('not-a-did')).toThrow();
    expect(() => resolveDidKey('did:key:nope')).toThrow(); // missing 'z'
    expect(() => resolveDidKey('did:key:zabc')).toThrow(); // bad multicodec
  });
});

describe('ES256 JWT', () => {
  it('signs + self-verifies', () => {
    const kp = generateP256KeyPair();
    const jwt = signJwtEs256(
      { alg: 'ES256', typ: 'JWT' },
      { sub: 'alice', iat: 1700000000 },
      kp.privateKey
    );
    const { payload } = verifyJwtEs256<{ sub: string; iat: number }>(
      jwt,
      publicKeyToJwk(kp.publicKey)
    );
    expect(payload.sub).toBe('alice');
    expect(payload.iat).toBe(1700000000);
  });

  it('rejects tampered payload', () => {
    const kp = generateP256KeyPair();
    const jwt = signJwtEs256(
      { alg: 'ES256' },
      { sub: 'alice' },
      kp.privateKey
    );
    const parts = jwt.split('.');
    const tamperedPayload = base64UrlEncode(
      utf8ToBytes(bytesToUtf8(base64UrlDecode(parts[1] ?? '')).replace('alice', 'mallory'))
    );
    const tamperedJwt = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
    expect(() =>
      verifyJwtEs256(tamperedJwt, publicKeyToJwk(kp.publicKey))
    ).toThrow();
  });
});

describe('round-trip helpers', () => {
  it('hexToBytes ↔ bytesToHex', () => {
    const hex = 'deadbeef00ff';
    expect(bytesToHex(hexToBytes(hex))).toBe(hex);
  });
});
