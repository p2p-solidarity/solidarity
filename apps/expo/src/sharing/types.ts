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
 * Per-group selective-disclosure policy applied AFTER the base
 * `SharingPreferences` overlay chain (global → per-card → per-group prefs).
 *
 * Goes beyond the Swift global-only model: Swift `ShareSettingsStore`
 * exposes only a flat per-field enable map and has no notion of a per-group
 * ceiling, allowlist, ZK-only flag, or forwarding lockdown. We add those
 * here because the Expo client owns the multi-group exchange surface.
 *
 * Every field is optional and STRICTLY tightens the base — a policy can
 * never grant a field or relax a flag the user has not already enabled.
 * Default-on behaviour is documented per field.
 */
export interface GroupSharingPolicy {
  /**
   * Hard ceiling on the audience tier this group context may request.
   * Example: a "co-workers" group caps at `'professional'` even if the
   * per-card pref tries to resolve at `'personal'`. The resolver clamps
   * the requested audience to `min(requested, ceiling)` using the
   * canonical order `public < professional < personal`.
   */
  readonly audienceCeiling?: AudienceTier;
  /**
   * Field-level allowlist — only these fields may leak inside this group,
   * even if per-card prefs allow more. The resolver intersects the
   * effective field set with this allowlist. `.name` is always kept
   * regardless (matches the Swift mandatory-name invariant).
   * Default: undefined (no extra restriction).
   */
  readonly fieldAllowlist?: readonly FieldKey[];
  /**
   * Field-level denylist — fields always stripped in this group's context
   * regardless of per-card / global prefs. The resolver subtracts these
   * from the effective field set after the allowlist intersection.
   * Default applied by `defaultGroupSharingPolicy()`: `['phone']` (the
   * conservative rule the previous commit shipped).
   */
  readonly fieldDenylist?: readonly FieldKey[];
  /**
   * When true, force `useZK = true` for any presentation in this group —
   * even if the card disabled ZK. Lets a group enforce ZK-only proof
   * presentations regardless of per-card opt-out.
   */
  readonly forceZk?: boolean;
  /**
   * When true, force `allowForwarding = false` regardless of card pref.
   * Lets a group lock down onward-sharing inside a closed circle.
   */
  readonly disallowForwarding?: boolean;
  /**
   * Free-form display name shown to the user when this policy applies,
   * for the "(N fields redacted due to group X policy)" banner the UI
   * will render. Surfaced via `ResolvedCard.appliedPolicy.reason`.
   */
  readonly displayReason?: string;
}

/**
 * Origin of the policy hit annotated on `ResolvedCard.appliedPolicy`.
 * - `'group'`  — caller passed an explicit `groupPolicy` and it applied.
 * - `'default'` — no explicit policy; the conservative default
 *                  (`defaultGroupSharingPolicy`) applied because a
 *                  group-typed `groupContext` was present.
 * - `'card'`   — per-card prefs alone caused a tightening (reserved
 *                  for future use; the current resolver does not surface
 *                  per-card-only annotations).
 */
export type AppliedPolicySource = 'group' | 'card' | 'default';

/**
 * The redacted card + a manifest of what was kept vs. stripped so the UI
 * can show "shared X fields, redacted Y" without re-running the resolver.
 * `appliedPolicy` is populated whenever a `GroupSharingPolicy` (explicit
 * or default) influenced the resolution, so UIs can render the redaction
 * banner with the policy's `displayReason`.
 */
export interface ResolvedCard {
  readonly card: BusinessCard;
  readonly includedFields: readonly FieldKey[];
  readonly excludedFields: readonly FieldKey[];
  readonly appliedPolicy?: {
    readonly source: AppliedPolicySource;
    readonly reason?: string;
  };
}
