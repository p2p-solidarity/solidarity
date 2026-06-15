/**
 * JWS ES256 sign + verify — mirrors VCService.swift's JWT issue/parse + the
 * Swift JOSE helpers in OIDCService+Helpers.swift.
 *
 * Format (RFC 7515 compact JWS): `<header>.<payload>.<signature>`
 *   - header / payload: base64url(JSON.stringify(obj))
 *   - signature: base64url(ECDSA r||s) over `<header>.<payload>` bytes
 *
 * Verification is byte-deterministic given pubkey + signature, so the
 * parity oracle is simply: "Swift signed → TS verifies true" and vice-versa.
 */
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { base64UrlDecode, base64UrlEncode, utf8ToBytes } from '../crypto/base64';
import { jwkToPublicKey } from './keyPair';
import type { PublicKeyJWK } from '../types/jwk';

export interface JwtHeader {
  readonly alg: 'ES256';
  readonly typ?: string;
  readonly kid?: string;
  readonly [key: string]: unknown;
}

export type JwtPayload = Readonly<Record<string, unknown>>;

/** Sign a JWT with a 32-byte P-256 private key. Returns compact JWS. */
export function signJwtEs256(
  header: JwtHeader,
  payload: JwtPayload,
  privateKey: Uint8Array
): string {
  if (header.alg !== 'ES256') {
    throw new Error(`signJwtEs256 requires alg=ES256 (got ${header.alg})`);
  }
  const headerB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const digest = sha256(utf8ToBytes(signingInput));
  // @noble/curves v2 p256.sign returns raw r||s bytes (Uint8Array) directly.
  const sigBytes = p256.sign(digest, privateKey);
  return `${signingInput}.${base64UrlEncode(sigBytes)}`;
}

/**
 * Verify a compact JWS with a JWK. Returns the decoded payload on success,
 * throws on signature mismatch or malformed JWT. The caller is responsible
 * for further claim checks (exp, aud, iss, nbf).
 */
export function verifyJwtEs256<T = JwtPayload>(
  jwt: string,
  jwk: PublicKeyJWK
): { readonly header: JwtHeader; readonly payload: T } {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('JWT must have three dot-separated parts');
  }
  const [headerB64, payloadB64, signatureB64] = parts as [
    string,
    string,
    string,
  ];

  const sigBytes = base64UrlDecode(signatureB64);
  if (sigBytes.length !== 64) {
    throw new Error('ES256 signature must be 64 raw bytes (r||s)');
  }
  const digest = sha256(utf8ToBytes(`${headerB64}.${payloadB64}`));
  const ok = p256.verify(sigBytes, digest, jwkToPublicKey(jwk));
  if (!ok) throw new Error('JWT signature verification failed');

  const header = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(headerB64))
  ) as JwtHeader;
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64))
  ) as T;
  return { header, payload };
}

/** Extract `header` + `payload` without verifying — for diagnostics only. */
export function decodeJwtUnsafe<T = JwtPayload>(
  jwt: string
): { readonly header: JwtHeader; readonly payload: T } {
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new Error('JWT must have three dot-separated parts');
  }
  const [headerB64, payloadB64] = parts as [string, string, string];
  const header = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(headerB64))
  ) as JwtHeader;
  const payload = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payloadB64))
  ) as T;
  return { header, payload };
}
