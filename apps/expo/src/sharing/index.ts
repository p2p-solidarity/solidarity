/**
 * `@/sharing` — selective-disclosure service layer.
 *
 * Public API:
 *   resolveCardForAudience / resolveEffectiveFields — pure resolvers
 *   defaultSharingPreferencesForLevel / defaultPreferencesForGroupContext — defaults
 *   useSharingSettings / hydrateSharingSettings — zustand+MMKV store
 *   ResolvedCard, AudienceTier, FieldKey — types
 */
export {
  defaultPreferencesForGroupContext,
  defaultSharingPreferencesForLevel,
  ALL_BUSINESS_CARD_FIELDS,
} from './defaults';
export {
  resolveCardForAudience,
  resolveEffectiveFields,
} from './scopeResolver';
export {
  hydrateSharingSettings,
  useSharingSettings,
} from './settingsStore';
export type {
  AudienceTier,
  BusinessCard,
  BusinessCardField,
  FieldKey,
  ResolvedCard,
  SharingLevel,
  SharingPreferences,
} from './types';
export { effectiveFields } from './types';
