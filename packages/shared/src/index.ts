/**
 * @solidarity/shared — pure TS types + crypto + identity + qr + vault + vcf
 * shared by apps/expo and nitro-modules.
 *
 * Domains (one folder = one ported Swift subsystem):
 *   types/      Zod 4 schemas mirroring solidarity/Models/
 *   crypto/     @noble/* AES-GCM, HKDF, SHA-256, base64url, hex
 *   identity/   DID:key derivation, JWK encoding, JWS sign/verify (P-256)
 *   qr/         sqc1 chunked-QR codec + reassembler
 *   vault/      Shamir SSS over GF(256)
 *   vcf/        vCard 3.0/4.0 parser used by the contact importer
 */
export * from './crypto';
export * from './identity';
export * from './importer';
export * from './qr';
export * from './types';
export * from './vault';
export * from './vcf';
