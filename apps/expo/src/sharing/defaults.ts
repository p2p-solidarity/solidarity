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
 * For the per-group overlay, Swift has NO `defaultPreferencesForGroupContext`
 * function — group context only changes the *signing surface* (group VC
 * vs. personal VC), not the field set. The Expo task spec asks for an
 * overlay anyway so callers can opt into stricter redaction during a
 * group exchange; we implement a documented, conservative rule:
 *
 *   - `{ type: 'personal' }` → no overlay (returns null)
 *   - `{ type: 'group' }`    → returns a SharingPreferences that hides
 *     `phone` from every tier (phone is the most personal contact channel
 *     and group exchanges are many-to-many by definition; matches Swift's
 *     UX intent that QR-to-group never leaks a phone number unless the
 *     holder explicitly opts in).
 *
 * TODO(sharing): once Swift adopts group-aware redaction, retune this
 * overlay to the new Swift constants and remove this note.
 */
import type {
  GroupCredentialContext,
  SharingPreferences,
} from '@solidarity/shared';

import type { BusinessCardField, SharingLevel } from './types';

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
 * Group-context overlay. Returns `null` when no overlay applies; otherwise
 * a `SharingPreferences` whose field sets should be intersected with the
 * caller's resolved preferences (see `scopeResolver.ts`).
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

/** Exported for tests + the resolver — single source of truth for the field universe. */
export const ALL_BUSINESS_CARD_FIELDS = ALL_FIELDS;
