/**
 * `ShareScopeResolver` — pure functions that combine global / per-card /
 * per-group sharing preferences and produce a redacted `BusinessCard` for
 * a given audience tier.
 *
 * Swift references:
 *   solidarity/Models/BusinessCard.swift::BusinessCard.filteredCard(for:)
 *     — the actual field stripper (lines 102-129). We mirror its exact
 *     null/empty-out behaviour: missing string fields become `undefined`
 *     (Swift `nil`), missing array fields become `[]`, and `.name` is
 *     never stripped (Swift sets `""` but the schema rejects empty names,
 *     so we keep the original name and rely on the always-on `.name`
 *     invariant in `defaults.ts`).
 *   solidarity/Models/BusinessCard.swift::SharingPreferences.effectiveFields(preferredLevel:)
 *     — collapses to `publicFields` if all three sets are equal, else picks
 *     by level. We reuse the `effectiveFields` helper from `@solidarity/shared`.
 *
 * Overlay precedence (innermost wins):
 *   1. global defaults (`globalDefaults` arg, else
 *      `defaultSharingPreferencesForLevel(audience)`)
 *   2. per-card overrides
 *   3. legacy group-context `SharingPreferences` overlay
 *      (`defaultPreferencesForGroupContext`, intersection)
 *   4. `GroupSharingPolicy` overlay (explicit `groupPolicy` arg, else the
 *      conservative `defaultGroupSharingPolicy()` when a group-typed
 *      `groupContext` is present). Applies four extra knobs on top of
 *      the base field set:
 *        - `audienceCeiling` clamps the requested tier downward
 *        - `fieldAllowlist` intersects the effective field set
 *        - `fieldDenylist`  subtracts from the effective field set
 *        - `forceZk` / `disallowForwarding` ratchet flags toward safer
 *
 *      The policy can only TIGHTEN — never grants new fields or relaxes
 *      a flag the user already set.
 *
 * The resolver returns both the redacted card and a manifest of included /
 * excluded fields so callers (QR generator, wallet pass builder, proximity
 * exchange) can render "shared X, redacted Y" UI without re-walking the
 * preferences object. When a policy tightening hits, `appliedPolicy`
 * surfaces the source + `displayReason` for the UI banner.
 */
import type {
  BusinessCard,
  GroupCredentialContext,
  SharingPreferences,
} from '@solidarity/shared';
import { effectiveFields } from '@solidarity/shared';

import {
  ALL_BUSINESS_CARD_FIELDS,
  defaultGroupSharingPolicy,
  defaultPreferencesForGroupContext,
  defaultSharingPreferencesForLevel,
} from './defaults';
import type {
  AppliedPolicySource,
  AudienceTier,
  FieldKey,
  GroupSharingPolicy,
  ResolvedCard,
} from './types';

interface ResolveArgs {
  readonly card: BusinessCard;
  readonly audience: AudienceTier;
  readonly perCardPrefs?: SharingPreferences;
  readonly groupContext?: GroupCredentialContext | null;
  readonly globalDefaults?: SharingPreferences;
  /**
   * Explicit per-group policy overlay. When undefined and `groupContext`
   * is a group-typed context, the resolver applies
   * `defaultGroupSharingPolicy()`. Pass `null` to opt out of policy
   * application entirely (e.g. for personal contexts where the caller
   * does not want the conservative default).
   */
  readonly groupPolicy?: GroupSharingPolicy | null;
}

/** Canonical ordering of audience tiers — used by `audienceCeiling` clamping. */
const TIER_RANK: Record<AudienceTier, number> = {
  public: 0,
  professional: 1,
  personal: 2,
};

/**
 * Clamp the requested audience by the policy ceiling. Returns the
 * stricter (lower-rank) of the two. Stable when no ceiling is set.
 */
function clampAudience(
  requested: AudienceTier,
  ceiling: AudienceTier | undefined
): AudienceTier {
  if (!ceiling) return requested;
  return TIER_RANK[ceiling] < TIER_RANK[requested] ? ceiling : requested;
}

/**
 * Pick the effective `GroupSharingPolicy` for a resolution call.
 *
 * - Explicit `policy` always wins (including `null`, which opts out).
 * - When `policy === undefined` and `context` is group-typed, the
 *   conservative `defaultGroupSharingPolicy()` applies — this is the
 *   safer-than-Swift default the previous commit's phone-drop rule
 *   formalised as a typed policy.
 * - Otherwise (no context / personal context), no policy applies.
 */
function effectivePolicy(
  policy: GroupSharingPolicy | null | undefined,
  context: GroupCredentialContext | null | undefined
): { readonly policy: GroupSharingPolicy | null; readonly source: AppliedPolicySource | null } {
  if (policy !== undefined) {
    return { policy, source: policy ? 'group' : null };
  }
  if (context?.type === 'group') {
    return { policy: defaultGroupSharingPolicy(), source: 'default' };
  }
  return { policy: null, source: null };
}

/**
 * Apply a `GroupSharingPolicy`'s field-set knobs (allowlist + denylist)
 * to the base allowed-set. `.name` is always preserved — matches the
 * mandatory-name invariant in `defaults.ts`. Returns the policy-restricted
 * set plus a boolean indicating whether the policy actually changed
 * anything (used to decide whether to populate `appliedPolicy`).
 */
function applyPolicyToFields(
  base: ReadonlySet<FieldKey>,
  policy: GroupSharingPolicy
): { readonly fields: ReadonlySet<FieldKey>; readonly changed: boolean } {
  const out = new Set<FieldKey>(base);
  let changed = false;
  if (policy.fieldAllowlist) {
    const allow = new Set<FieldKey>(policy.fieldAllowlist);
    allow.add('name');
    for (const f of base) {
      if (!allow.has(f) && out.delete(f)) changed = true;
    }
  }
  if (policy.fieldDenylist) {
    for (const f of policy.fieldDenylist) {
      if (f === 'name') continue; // mandatory — never deniable
      if (out.delete(f)) changed = true;
    }
  }
  out.add('name');
  return { fields: out, changed };
}

/**
 * Did the resolved policy actually influence the result? Encapsulates the
 * "should the UI banner fire?" decision so `resolveCardForAudience` stays
 * within the lint complexity ceiling. See the inline comment in the
 * caller for the per-knob rationale.
 */
function isPolicyHit(args: {
  readonly policy: GroupSharingPolicy;
  readonly audienceClamped: boolean;
  readonly fieldsChanged: boolean;
  readonly cardLevel: SharingPreferences;
}): boolean {
  const { policy, audienceClamped, fieldsChanged, cardLevel } = args;
  const flagsForcedZk = policy.forceZk && !cardLevel.useZK;
  const flagsDisallowedFwd = policy.disallowForwarding && cardLevel.allowForwarding;
  const policyDeclaresField =
    (policy.fieldAllowlist?.length ?? 0) > 0 ||
    (policy.fieldDenylist?.length ?? 0) > 0;
  return (
    audienceClamped ||
    fieldsChanged ||
    !!flagsForcedZk ||
    !!flagsDisallowedFwd ||
    policyDeclaresField
  );
}

/**
 * Intersection of two field sets keyed by `audience` tier — used when
 * applying the group-context overlay. A null `b` means no overlay
 * applies, so `a` passes through unchanged.
 */
function intersectForTier(
  a: SharingPreferences,
  b: SharingPreferences | null,
  audience: AudienceTier
): ReadonlySet<FieldKey> {
  const aFields = effectiveFields(a, audience);
  const out = new Set<FieldKey>();
  if (b) {
    const bFields = effectiveFields(b, audience);
    for (const f of aFields) {
      if (bFields.has(f)) out.add(f as FieldKey);
    }
  } else {
    for (const f of aFields) out.add(f as FieldKey);
  }
  // `.name` is mandatory regardless of intersection — matches Swift's
  // SharingPreferences.init contract that re-inserts `.name` into every set.
  out.add('name');
  return out;
}

/**
 * Strip card fields whose key is NOT in `allowed`. Mirrors
 * `BusinessCard.filteredCard(for: Set<BusinessCardField>)` line-for-line
 * (BusinessCard.swift:118-129) except `name` is preserved verbatim — the
 * zod schema requires `name.min(1)`, and the always-on `.name` invariant
 * means we should never reach a state where it'd be dropped.
 */
function applyFieldMask(
  card: BusinessCard,
  allowed: ReadonlySet<FieldKey>
): BusinessCard {
  return {
    ...card,
    title: allowed.has('title') ? card.title : undefined,
    company: allowed.has('company') ? card.company : undefined,
    email: allowed.has('email') ? card.email : undefined,
    phone: allowed.has('phone') ? card.phone : undefined,
    profileImage: allowed.has('profileImage') ? card.profileImage : undefined,
    socialNetworks: allowed.has('socialNetworks') ? card.socialNetworks : [],
    skills: allowed.has('skills') ? card.skills : [],
  };
}

/**
 * Resolve a card for the requested audience tier. Pure function: no I/O,
 * no zustand reads — pass the relevant prefs in. The `settingsStore`
 * convenience method does the lookups for callers.
 */
export function resolveCardForAudience(args: ResolveArgs): ResolvedCard {
  const { card, audience, perCardPrefs, groupContext, globalDefaults, groupPolicy } = args;

  // 1. Start with global defaults (or hardcoded per-level defaults).
  const base = globalDefaults ?? defaultSharingPreferencesForLevel(audience);

  // 2. Per-card overrides win over global — straight replace, not merge.
  //    Matches Swift `BusinessCard.sharingPreferences` always taking
  //    precedence over `ShareSettingsStore.enabledFields` when both exist.
  const cardLevel = perCardPrefs ?? base;

  // 3. Resolve the effective GroupSharingPolicy (explicit > default > none).
  const { policy, source } = effectivePolicy(groupPolicy, groupContext);

  // 4. Apply policy-level audience ceiling BEFORE the field intersection
  //    so the base SharingPreferences are evaluated at the clamped tier.
  const effectiveAudience = policy
    ? clampAudience(audience, policy.audienceCeiling)
    : audience;
  const audienceClamped = effectiveAudience !== audience;

  // 5. Legacy group-context SharingPreferences overlay (intersection).
  const overlay = defaultPreferencesForGroupContext(groupContext);
  const baseAllowed = intersectForTier(cardLevel, overlay, effectiveAudience);

  // 6. Apply the policy's field allowlist / denylist on top.
  const { fields: allowed, changed: fieldsChanged } = policy
    ? applyPolicyToFields(baseAllowed, policy)
    : { fields: baseAllowed, changed: false };

  // 7. Apply mask + compute the included/excluded manifest.
  const redacted = applyFieldMask(card, allowed);
  const included: FieldKey[] = [];
  const excluded: FieldKey[] = [];
  for (const f of ALL_BUSINESS_CARD_FIELDS) {
    if (allowed.has(f)) included.push(f);
    else excluded.push(f);
  }

  // 8. Surface the policy reason whenever the policy is constraining —
  //    see `isPolicyHit` for the per-knob rules.
  if (
    policy &&
    source &&
    isPolicyHit({ policy, audienceClamped, fieldsChanged, cardLevel })
  ) {
    return {
      card: redacted,
      includedFields: included,
      excludedFields: excluded,
      appliedPolicy: { source, reason: policy.displayReason },
    };
  }

  return { card: redacted, includedFields: included, excludedFields: excluded };
}

/**
 * Compute just the allowed-field set without redacting a card. Useful
 * for the QR scope-string builder (`ShareScopeResolver.scope(...)` in
 * Swift) and the wallet-pass builder that needs the field list ahead
 * of materialising the card payload. Applies the same policy overlay
 * as `resolveCardForAudience`.
 */
export function resolveEffectiveFields(args: ResolveArgs): ReadonlySet<FieldKey> {
  const { audience, perCardPrefs, groupContext, globalDefaults, groupPolicy } = args;
  const base = globalDefaults ?? defaultSharingPreferencesForLevel(audience);
  const cardLevel = perCardPrefs ?? base;
  const { policy } = effectivePolicy(groupPolicy, groupContext);
  const effectiveAudience = policy
    ? clampAudience(audience, policy.audienceCeiling)
    : audience;
  const overlay = defaultPreferencesForGroupContext(groupContext);
  const baseAllowed = intersectForTier(cardLevel, overlay, effectiveAudience);
  if (!policy) return baseAllowed;
  return applyPolicyToFields(baseAllowed, policy).fields;
}

/**
 * Resolve the effective ZK / forwarding flags after the policy overlay.
 * Returns `useZK` and `allowForwarding` ratcheted by the policy:
 *
 *   useZK           = base.useZK OR policy.forceZk
 *   allowForwarding = base.allowForwarding AND NOT policy.disallowForwarding
 *
 * Pure — never mutates the input prefs.
 */
export function resolveEffectiveFlags(args: ResolveArgs): {
  readonly useZK: boolean;
  readonly allowForwarding: boolean;
} {
  const { audience, perCardPrefs, groupContext, globalDefaults, groupPolicy } = args;
  const base = globalDefaults ?? defaultSharingPreferencesForLevel(audience);
  const cardLevel = perCardPrefs ?? base;
  const { policy } = effectivePolicy(groupPolicy, groupContext);
  const useZK = policy?.forceZk ? true : cardLevel.useZK;
  const allowForwarding = policy?.disallowForwarding
    ? false
    : cardLevel.allowForwarding;
  return { useZK, allowForwarding };
}
