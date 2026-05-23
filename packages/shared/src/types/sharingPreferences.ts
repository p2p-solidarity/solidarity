/**
 * SharingPreferences — mirrors solidarity/Models/BusinessCard.swift.
 *
 * Migration path: legacy Swift Codable instances may lack `sharingFormat`.
 * In Swift it defaults to `.didSigned` via a custom init(from decoder:).
 * We replicate that default via `.default(...)` so legacy JSON parses
 * cleanly without losing data.
 */
import { z } from 'zod';

import { businessCardFieldSchema, sharingFormatSchema } from './sharingFormat';

export const sharingPreferencesSchema = z.object({
  publicFields: z.array(businessCardFieldSchema).transform((a) => new Set(a)),
  professionalFields: z
    .array(businessCardFieldSchema)
    .transform((a) => new Set(a)),
  personalFields: z.array(businessCardFieldSchema).transform((a) => new Set(a)),
  allowForwarding: z.boolean().default(true),
  expirationDate: z.coerce.date().optional(),
  useZK: z.boolean().default(false),
  sharingFormat: sharingFormatSchema.default('didSigned'),
});
export type SharingPreferences = z.infer<typeof sharingPreferencesSchema>;

/** Resolve the effective field set for a given sharing level. */
export function effectiveFields(
  prefs: SharingPreferences,
  level: 'public' | 'professional' | 'personal'
): ReadonlySet<string> {
  switch (level) {
    case 'public':
      return prefs.publicFields;
    case 'professional':
      return prefs.professionalFields;
    case 'personal':
      return prefs.personalFields;
  }
}
