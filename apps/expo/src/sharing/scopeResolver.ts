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
 *   3. group-context overlay (intersection — group can only TIGHTEN, never
 *      grant fields the user has not already enabled at the global/per-card
 *      level)
 *
 * The resolver returns both the redacted card and a manifest of included /
 * excluded fields so callers (QR generator, wallet pass builder, proximity
 * exchange) can render "shared X, redacted Y" UI without re-walking the
 * preferences object.
 */
import type {
  BusinessCard,
  GroupCredentialContext,
  SharingPreferences,
} from '@solidarity/shared';
import { effectiveFields } from '@solidarity/shared';

import { ALL_BUSINESS_CARD_FIELDS, defaultPreferencesForGroupContext, defaultSharingPreferencesForLevel } from './defaults';
import type { AudienceTier, FieldKey, ResolvedCard } from './types';

interface ResolveArgs {
  readonly card: BusinessCard;
  readonly audience: AudienceTier;
  readonly perCardPrefs?: SharingPreferences;
  readonly groupContext?: GroupCredentialContext | null;
  readonly globalDefaults?: SharingPreferences;
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
  const { card, audience, perCardPrefs, groupContext, globalDefaults } = args;

  // 1. Start with global defaults (or hardcoded per-level defaults).
  const base = globalDefaults ?? defaultSharingPreferencesForLevel(audience);

  // 2. Per-card overrides win over global — straight replace, not merge.
  //    Matches Swift `BusinessCard.sharingPreferences` always taking
  //    precedence over `ShareSettingsStore.enabledFields` when both exist.
  const cardLevel = perCardPrefs ?? base;

  // 3. Group-context overlay (intersection, never grants new fields).
  const overlay = defaultPreferencesForGroupContext(groupContext);
  const allowed = intersectForTier(cardLevel, overlay, audience);

  // 4. Apply mask + compute the included/excluded manifest.
  const redacted = applyFieldMask(card, allowed);
  const included: FieldKey[] = [];
  const excluded: FieldKey[] = [];
  for (const f of ALL_BUSINESS_CARD_FIELDS) {
    if (allowed.has(f)) included.push(f);
    else excluded.push(f);
  }

  return { card: redacted, includedFields: included, excludedFields: excluded };
}

/**
 * Compute just the allowed-field set without redacting a card. Useful
 * for the QR scope-string builder (`ShareScopeResolver.scope(...)` in
 * Swift) and the wallet-pass builder that needs the field list ahead
 * of materialising the card payload.
 */
export function resolveEffectiveFields(args: ResolveArgs): ReadonlySet<FieldKey> {
  const { audience, perCardPrefs, groupContext, globalDefaults } = args;
  const base = globalDefaults ?? defaultSharingPreferencesForLevel(audience);
  const cardLevel = perCardPrefs ?? base;
  const overlay = defaultPreferencesForGroupContext(groupContext);
  return intersectForTier(cardLevel, overlay, audience);
}
