/**
 * Contact + supporting enums — mirrors solidarity/Models/Contact.swift.
 *
 * Wire format note: Swift rawValues are display-form strings for
 * ContactSource ("QR Code", "App Clip", …) and for VerificationStatus
 * ("Verified", "Unverified", …). Preserve verbatim so QR/JWT payloads
 * round-trip byte-equal.
 *
 * Encryption keys (`pubKey`, `signPubKey`, `didPublicKey`) stay as base64
 * strings; binary signatures decode to Uint8Array on first read in TS.
 */
import { z } from 'zod';

import { businessCardSchema } from './businessCard';

export const contactSourceSchema = z.enum([
  'QR Code',
  'Proximity',
  'App Clip',
  'Manual',
  'AirDrop',
]);
export type ContactSource = z.infer<typeof contactSourceSchema>;

export const verificationStatusSchema = z.enum([
  'Verified',
  'Unverified',
  'Failed',
  'Pending',
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

const base64BytesSchema = z
  .string()
  .regex(/^[A-Za-z0-9+/=]+$/, 'base64')
  .optional();

export const contactSchema = z.object({
  id: z.uuid(),
  businessCard: businessCardSchema,
  receivedAt: z.coerce.date(),
  source: contactSourceSchema,
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  verificationStatus: verificationStatusSchema.default('Unverified'),
  lastInteraction: z.coerce.date().optional(),

  /** Sakura sealed routing (blind mailbox). */
  sealedRoute: z.string().optional(),
  /** X25519 public key (base64). */
  pubKey: z.string().optional(),
  /** Ed25519 public key (base64). */
  signPubKey: z.string().optional(),
  /** did:key holder DID public key (base64). */
  didPublicKey: z.string().optional(),

  /** Peer's exchange signature over our session metadata (base64). */
  exchangeSignature: base64BytesSchema,
  /** Our exchange signature over the peer's session metadata (base64). */
  myExchangeSignature: base64BytesSchema,
  exchangeTimestamp: z.coerce.date().optional(),
  myEphemeralMessage: z.string().optional(),
  theirEphemeralMessage: z.string().optional(),
});
export type Contact = z.infer<typeof contactSchema>;
