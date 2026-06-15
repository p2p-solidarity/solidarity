/**
 * `@/sharing` — selective-disclosure service layer.
 *
 * Public API:
 *   resolveCardForAudience / resolveEffectiveFields / resolveEffectiveFlags
 *     — pure resolvers (policy-aware)
 *   defaultSharingPreferencesForLevel / defaultPreferencesForGroupContext
 *     — base preference defaults
 *   defaultGroupSharingPolicy — conservative per-group policy default
 *   useSharingSettings / hydrateSharingSettings — zustand+MMKV store
 *     (now with `perGroupPolicies` + `setGroupPolicy` / `getGroupPolicy`)
 *   ResolvedCard, AudienceTier, FieldKey, GroupSharingPolicy,
 *   AppliedPolicySource — types
 */
export {
  ALL_BUSINESS_CARD_FIELDS,
  defaultGroupSharingPolicy,
  defaultPreferencesForGroupContext,
  defaultSharingPreferencesForLevel,
} from './defaults';
export {
  resolveCardForAudience,
  resolveEffectiveFields,
  resolveEffectiveFlags,
} from './scopeResolver';
export {
  hydrateSharingSettings,
  useSharingSettings,
} from './settingsStore';
export type {
  AppliedPolicySource,
  AudienceTier,
  BusinessCard,
  BusinessCardField,
  FieldKey,
  GroupSharingPolicy,
  ResolvedCard,
  SharingLevel,
  SharingPreferences,
} from './types';
export { effectiveFields } from './types';
