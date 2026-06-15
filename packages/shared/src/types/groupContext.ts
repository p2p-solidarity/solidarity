/**
 * GroupCredentialContext — mirrors
 * solidarity/Models/GroupCredentialContext.swift.
 *
 * Swift uses an associated-value enum: `.personal` or `.group(GroupCredentialInfo)`.
 * We model it as a tagged union so JSON wire stays unambiguous:
 *   { "type": "personal" }
 *   { "type": "group", "info": { groupId, groupName, ... } }
 */
import { z } from 'zod';

export const groupCredentialInfoSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  merkleRoot: z.string().regex(/^[0-9a-fA-F]+$/, 'hex string'),
  issuedBy: z.string().min(1),
  issuedAt: z.coerce.date(),
  proofRequired: z.boolean(),
});
export type GroupCredentialInfo = z.infer<typeof groupCredentialInfoSchema>;

export const groupCredentialContextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('personal') }),
  z.object({ type: z.literal('group'), info: groupCredentialInfoSchema }),
]);
export type GroupCredentialContext = z.infer<typeof groupCredentialContextSchema>;
