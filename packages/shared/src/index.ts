/**
 * @solidarity/shared — pure TS types + utils used by apps/expo + nitro-modules.
 *
 * Domains land here as the port progresses (see
 * docs/migration/00-MIGRATION_PLAN.md Phase 1-7):
 *   types/      Zod schemas + TS types ported 1:1 from solidarity/Models/
 *   crypto/     @noble/* wrappers (AES-GCM, ECDSA P-256, HKDF, Pedersen)
 *   identity/   DID:key derivation, JWK encoding, JWT sign/verify
 *   qr/         QR codec + chunking protocol (mirrors QRCodeChunkingService)
 *   sakura/     Snake-case wire format encoders/decoders for Sakura messaging
 */
export {};
