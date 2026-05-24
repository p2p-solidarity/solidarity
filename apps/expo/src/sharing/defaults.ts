/**
 * Default `SharingPreferences` per audience tier — mirror of Swift
 * `SharingPreferences.init(...)` literals in
 * `solidarity/Models/BusinessCard.swift` (lines 266-289):
 *
 *   publicFields       = [.name, .title, .company]
 *   professionalFields = [.name, .title, .company, .email, .skills]
 *   personalFields     = BusinessCardField.allCases     // all 8
 *   allowForwarding    = false
 *   useZK              = true
 *   sharingFormat      = .didSigned
 *
 * The Swift init also force-inserts `.name` into every level. We do the
 * same in `withMandatoryName(...)` so callers can't construct a level
 * that drops the holder's identity.
 *
 * Per-group overlay — Expo extends Swift here. Swift has no
 * `defaultPreferencesForGroupContext` and no per-group field-redaction
 * policy: `ShareSettingsStore` exposes a single flat per-field enable
 * map for the whole user. The Expo client owns the multi-group exchange
 * surface, so we offer:
 *
 *   1. `defaultPreferencesForGroupContext(group)` — legacy, retained for
 *      backwards compat. Returns a `SharingPreferences` that simply hides
 *      `phone` for any group-typed context (the conservative rule that
 *      shipped in commit d7a5787). New callers should prefer the richer
 *      `GroupSharingPolicy` surface below.
 *   2. `defaultGroupSharingPolicy()` — documented conservative default:
 *      `{ fieldDenylist: ['phone'], displayReason: 'Conservative group default' }`.
 *      Used by `scopeResolver.ts` whenever a group-typed context is
 *      present but the caller (or `useSharingSettings.perGroupPolicies`)
 *      hasn't set an explicit policy. Strictly safer than Swift because
 *      the resolver can additionally clamp the audience tier, intersect
 *      against an allowlist, force ZK, and forbid forwarding — see
 *      `GroupSharingPolicy` in `types.ts`.
 */
import type {
  GroupCredentialContext,
  SharingPreferences,
} from '@solidarity/shared';

import type {
  BusinessCardField,
  GroupSharingPolicy,
  SharingLevel,
} from './types';

const ALL_FIELDS: readonly BusinessCardField[] = [
  'name',
  'title',
  'company',
  'email',
  'phone',
  'profileImage',
  'socialNetworks',
  'skills',
];

const PUBLIC_FIELDS: readonly BusinessCardField[] = ['name', 'title', 'company'];
const PROFESSIONAL_FIELDS: readonly BusinessCardField[] = [
  'name',
  'title',
  'company',
  'email',
  'skills',
];

function withMandatoryName(
  fields: readonly BusinessCardField[]
): Set<BusinessCardField> {
  const out = new Set<BusinessCardField>(fields);
  out.add('name');
  return out;
}

/**
 * Construct the default `SharingPreferences` whose field sets favour the
 * given tier. All three field sets are populated — `effectiveFields(...)`
 * picks one at resolve time — but the named tier is the "intended"
 * level used when no per-card override exists.
 *
 * Parameter currently unused at the literal-default level (Swift always
 * populates all three sets identically). Kept for API symmetry with the
 * task spec and so a future "tier-specific tightening" can land without
 * a signature change.
 */
export function defaultSharingPreferencesForLevel(
  _level: SharingLevel
): SharingPreferences {
  return {
    publicFields: withMandatoryName(PUBLIC_FIELDS),
    professionalFields: withMandatoryName(PROFESSIONAL_FIELDS),
    personalFields: withMandatoryName(ALL_FIELDS),
    allowForwarding: false,
    expirationDate: undefined,
    useZK: true,
    sharingFormat: 'didSigned',
  };
}

/**
 * Group-context overlay (legacy `SharingPreferences` form). Returns `null`
 * when no overlay applies; otherwise a `SharingPreferences` whose field
 * sets should be intersected with the caller's resolved preferences.
 *
 * Retained for backwards compat with commit d7a5787 — the scope resolver
 * still applies this overlay as part of the base preferences chain.
 * Net new redaction (audience ceiling, allowlist, ZK / forwarding
 * forcing) lives on `GroupSharingPolicy` and is layered ON TOP of this
 * by the resolver.
 */
export function defaultPreferencesForGroupContext(
  group: GroupCredentialContext | null | undefined
): SharingPreferences | null {
  if (!group) return null;
  if (group.type === 'personal') return null;
  // Group exchange — drop `phone` from every level.
  const restricted = ALL_FIELDS.filter((f) => f !== 'phone');
  return {
    publicFields: withMandatoryName(restricted.filter((f) => PUBLIC_FIELDS.includes(f))),
    professionalFields: withMandatoryName(
      restricted.filter((f) => PROFESSIONAL_FIELDS.includes(f))
    ),
    personalFields: withMandatoryName(restricted),
    allowForwarding: false,
    expirationDate: undefined,
    useZK: true,
    sharingFormat: 'didSigned',
  };
}

/**
 * Conservative default `GroupSharingPolicy` applied when a group-typed
 * `GroupCredentialContext` is present but the caller hasn't supplied an
 * explicit policy. Mirrors the field-redaction intent of the legacy
 * `defaultPreferencesForGroupContext` rule (`phone` is stripped), and
 * adds a `displayReason` so UIs can render the redaction banner without
 * special-casing the "no explicit policy" branch.
 *
 * Returning a fresh object per call keeps the policy safe to mutate at
 * the call site (e.g. spread + override one field) without poisoning a
 * shared constant.
 */
export function defaultGroupSharingPolicy(): GroupSharingPolicy {
  return {
    fieldDenylist: ['phone'],
    displayReason: 'Conservative group default',
  };
}

/** Exported for tests + the resolver — single source of truth for the field universe. */
export const ALL_BUSINESS_CARD_FIELDS = ALL_FIELDS;
