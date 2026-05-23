/**
 * Sakura messaging wire types — mirror
 * solidarity/Models/SecureMessagingModels.swift.
 *
 * IMPORTANT: the JSON wire is **snake_case** (server contract); Swift uses
 * camelCase locally and renames via CodingKeys. We keep the wire shape
 * verbatim here so JSON round-trips byte-equal with no transformation.
 * If TS app code wants camelCase locally, apply `.transform()` at the
 * call site, NOT in this schema.
 */
import { z } from 'zod';

export const sealResponseSchema = z.object({
  sealed_route: z.string().min(1),
});
export type SealResponse = z.infer<typeof sealResponseSchema>;

export const sendRequestSchema = z.object({
  recipient_pubkey: z.string().min(1),
  /** AES-256-GCM ciphertext (base64). */
  blob: z.string().min(1),
  sealed_route: z.string().min(1),
  sender_pubkey: z.string().min(1),
  /** ECDSA P-256 signature over the request (base64). */
  sender_sig: z.string().min(1),
});
export type SendRequest = z.infer<typeof sendRequestSchema>;

export const inboxMessageSchema = z.object({
  id: z.string().min(1),
  owner_pubkey: z.string().min(1),
  blob: z.string().min(1),
  /** Unix epoch seconds. */
  created_at: z.number(),
});
export type InboxMessage = z.infer<typeof inboxMessageSchema>;

export const syncResponseSchema = z.object({
  messages: z.array(inboxMessageSchema),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;

export const ackRequestSchema = z.object({
  message_ids: z.array(z.string()),
  pubkey: z.string().min(1),
  sig: z.string().min(1),
});
export type AckRequest = z.infer<typeof ackRequestSchema>;
