/**
 * filteredCardFor — port of `BusinessCard.filteredCard(for:)` from
 * solidarity/Models/BusinessCard.swift.
 *
 * Returns a shallow copy of the card whose excluded fields are blanked
 * according to the supplied sharing level. The shared module already
 * exposes `effectiveFields(prefs, level)` so we lean on it directly.
 */
import {
  effectiveFields,
  type BusinessCard,
  type SharingLevel,
} from '@solidarity/shared';

export function filteredCardFor(
  card: BusinessCard,
  level: SharingLevel
): BusinessCard {
  const allowed = effectiveFields(card.sharingPreferences, level);
  return {
    ...card,
    name: allowed.has('name') ? card.name : '',
    title: allowed.has('title') ? card.title : undefined,
    company: allowed.has('company') ? card.company : undefined,
    email: allowed.has('email') ? card.email : undefined,
    phone: allowed.has('phone') ? card.phone : undefined,
    profileImage: allowed.has('profileImage') ? card.profileImage : undefined,
    socialNetworks: allowed.has('socialNetworks') ? card.socialNetworks : [],
    skills: allowed.has('skills') ? card.skills : [],
  };
}
