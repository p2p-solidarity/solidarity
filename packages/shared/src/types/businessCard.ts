/**
 * BusinessCard — mirrors solidarity/Models/BusinessCard.swift.
 *
 * Migration shape: UUID id → string. profileImage Swift Data → base64 string
 * (we keep it as a discriminated union so callers can lazily decode). Custom
 * decoder defaults in Swift map cleanly to Zod `.default(...)` / `.optional()`.
 *
 * Cross-ref: agents inventory in docs/migration/03-models-inventory.md.
 */
import { z } from 'zod';

import { animalSchema } from './animal';
import { groupCredentialContextSchema } from './groupContext';
import {
  businessCardFieldSchema,
  nameTypeSchema,
} from './sharingFormat';
import { sharingPreferencesSchema } from './sharingPreferences';
import { skillSchema, socialNetworkSchema } from './social';

export const businessCardSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  title: z.string().optional(),
  company: z.string().optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  /** Base64-encoded image bytes (Swift `Data`). */
  profileImage: z.string().optional(),
  animal: animalSchema.optional(),
  socialNetworks: z.array(socialNetworkSchema).default([]),
  skills: z.array(skillSchema).default([]),
  categories: z.array(z.string()).default([]),
  sharingPreferences: sharingPreferencesSchema,
  groupContext: groupCredentialContextSchema.optional(),
  verifiedFields: z
    .preprocess(
      (val) => (val instanceof Set ? Array.from(val) : val),
      z.array(businessCardFieldSchema).optional()
    )
    .transform((a) => (a ? new Set(a) : undefined)),
  nameType: nameTypeSchema.default('display_name'),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type BusinessCard = z.infer<typeof businessCardSchema>;
