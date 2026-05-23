/**
 * PublicKeyJWK — mirrors BusinessCardCredential.swift's nested PublicKeyJWK
 * struct. Wire format is RFC 7517 JWK: kty, crv, alg, x, y all base64url.
 *
 * Only P-256 (`crv: "P-256"`, `alg: "ES256"`) is used in Solidarity today;
 * the schema rejects everything else so we fail fast on issuer typos
 * rather than silently shipping the wrong curve into a VC.
 */
import { z } from 'zod';

const base64urlRegex = /^[A-Za-z0-9_-]+$/;

export const publicKeyJwkSchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  alg: z.literal('ES256'),
  x: z.string().regex(base64urlRegex, 'base64url'),
  y: z.string().regex(base64urlRegex, 'base64url'),
});
export type PublicKeyJWK = z.infer<typeof publicKeyJwkSchema>;
