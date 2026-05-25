/**
 * SharingPreferences — mirrors solidarity/Models/BusinessCard.swift.
 *
 * Migration path: legacy Swift Codable instances may lack `sharingFormat`.
 * In Swift it defaults to `.didSigned` via a custom init(from decoder:).
 * We replicate that default via `.default(...)` so legacy JSON parses
 * cleanly without losing data.
 *
 * Runtime shape: `*Fields` are `Set<BusinessCardField>` so callers can use
 * `.has()` / `.add()` like Swift's `Set<BusinessCardField>`. Zod's
 * `.transform(new Set)` is one-way though — re-parsing an already-parsed
 * object would fail because the input would be a Set, not an array. We
 * normalise via `z.preprocess` so both shapes survive a `safeParse`
 * round-trip (needed by cardManager.upsert).
 */
import { z } from 'zod';

import { businessCardFieldSchema, sharingFormatSchema } from './sharingFormat';

const fieldSetSchema = z
  .preprocess(
    (val) => (val instanceof Set ? Array.from(val) : val),
    z.array(businessCardFieldSchema)
  )
  .transform((a) => new Set(a));

export const sharingPreferencesSchema = z.object({
  publicFields: fieldSetSchema,
  professionalFields: fieldSetSchema,
  personalFields: fieldSetSchema,
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
