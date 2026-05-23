/**
 * @solidarity/shared — pure TS types + crypto + identity utils shared by
 * apps/expo and nitro-modules.
 *
 * Phase 1 deliverables (committed):
 *   types/      Zod 4 schemas + TS types ported from solidarity/Models/
 *   crypto/     @noble/* wrappers (AES-GCM, HKDF, SHA-256, base64url)
 *
 * Phase 2+ (upcoming):
 *   identity/   DID:key derivation, JWK encoding, JWS sign/verify
 *   qr/         QR codec + chunking protocol (mirrors QRCodeChunkingService)
 *   sakura/     Snake-case wire format encoders for the Sakura relay
 */
export * from './crypto';
export * from './identity';
export * from './qr';
export * from './types';
export * from './vault';
