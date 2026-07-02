/**
 * @solidarity/shared — pure TS types + crypto + identity + qr + vault + vcf
 * shared by apps/expo and nitro-modules.
 *
 * Domains (one folder = one ported Swift subsystem):
 *   types/      Zod 4 schemas mirroring solidarity/Models/
 *   crypto/     @noble/* AES-GCM, HKDF, SHA-256, base64url, hex
 *   identity/   DID:key derivation, JWK encoding, ad-hoc ES256 JWT sign/verify
 *   qr/         sqc1 chunked-QR codec + reassembler
 *   vault/      Shamir SSS over GF(256)
 *   vcf/        vCard 3.0/4.0 parser used by the contact importer
 *
 * Top-level primitives (single file, no subsystem folder):
 *   canonical.ts  Deterministic JSON (recursive key sort) — shared by DAG
 *                 node ids (apps/expo/src/dag/node.ts) and JWS payloads
 *   jws.ts        The one compact-JWS sign/verify primitive for did:key
 *                 authenticated payloads (profile / challenge / Pear)
 */
export * from './canonical';
export * from './crypto';
export * from './identity';
export * from './importer';
export * from './jws';
export * from './qr';
export * from './sakura';
export * from './types';
export * from './vault';
export * from './vcf';
