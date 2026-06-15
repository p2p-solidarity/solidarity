/**
 * Social profile types — mirrors SocialNetwork / SocialPlatform / Skill /
 * ProficiencyLevel from solidarity/Models/BusinessCard.swift.
 *
 * Wire format note: Swift rawValues use display-form strings ("LinkedIn",
 * not "linkedin"). We preserve those literals so JWT/QR payloads round-trip
 * byte-equal between Swift and TS.
 */
import { z } from 'zod';

export const socialPlatformSchema = z.enum([
  'LinkedIn',
  'Twitter',
  'Instagram',
  'Facebook',
  'GitHub',
  'Website',
  'Other',
]);
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

export const socialNetworkSchema = z.object({
  id: z.uuid(),
  platform: socialPlatformSchema,
  username: z.string().min(1),
  url: z.url().optional(),
});
export type SocialNetwork = z.infer<typeof socialNetworkSchema>;

export const proficiencyLevelSchema = z.enum([
  'Beginner',
  'Intermediate',
  'Advanced',
  'Expert',
]);
export type ProficiencyLevel = z.infer<typeof proficiencyLevelSchema>;

export const skillSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  category: z.string(),
  proficiencyLevel: proficiencyLevelSchema,
});
export type Skill = z.infer<typeof skillSchema>;
