/**
 * Local sharing types — re-export the canonical schema surface from
 * `@solidarity/shared` so callers in `apps/expo` import everything from
 * one place. We intentionally do not define a parallel zod schema here;
 * the source of truth lives in `packages/shared/src/types/sharingPreferences.ts`.
 *
 * Swift reference: solidarity/Services/Sharing/ShareScopeResolver.swift
 * and solidarity/Services/Sharing/ShareSettingsStore.swift.
 *
 * `AudienceTier` is an alias of `SharingLevel` — Swift never introduced a
 * separate "audience" concept; the same three tiers (public / professional /
 * personal) classify both the sender's preference and the receiver's role.
 * Keeping a distinct alias name documents intent at the resolver call site
 * (`resolveCardForAudience({ audience: 'professional' })`) without spawning
 * a parallel enum that would need to stay in lockstep.
 */
import type {
  BusinessCard,
  BusinessCardField,
  SharingLevel,
} from '@solidarity/shared';

export type {
  BusinessCard,
  BusinessCardField,
  SharingLevel,
  SharingPreferences,
} from '@solidarity/shared';
export { effectiveFields } from '@solidarity/shared';

/**
 * Audience tier — alias of `SharingLevel`. Use this name when describing
 * the receiver's role; use `SharingLevel` when describing the sender's
 * per-field preference. Same union: `'public' | 'professional' | 'personal'`.
 */
export type AudienceTier = SharingLevel;

/** A single redactable field on a business card (string keys match Swift `BusinessCardField`). */
export type FieldKey = BusinessCardField;

/**
 * The redacted card + a manifest of what was kept vs. stripped so the UI
 * can show "shared X fields, redacted Y" without re-running the resolver.
 */
export interface ResolvedCard {
  readonly card: BusinessCard;
  readonly includedFields: readonly FieldKey[];
  readonly excludedFields: readonly FieldKey[];
}
