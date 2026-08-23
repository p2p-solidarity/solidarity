import { visibilityAt, type LinkVisibility } from '@/profile/projection';
import {
  enabledFieldsFromSharePreferences,
  type ShareFieldPreferences,
} from '@/cards/solidarityQrTypes';
import type { BusinessCard, BusinessCardField, ProfileLink } from '@solidarity/shared';

export type PresentCardState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'error' }
  | { readonly kind: 'ready'; readonly card: BusinessCard };

export interface PresentModelInput {
  readonly cardState: PresentCardState;
  readonly links: readonly ProfileLink[];
  readonly linkVisibility: readonly LinkVisibility[];
  readonly preferences: ShareFieldPreferences;
}

export interface PresentPublicLink {
  readonly link: ProfileLink;
  readonly sourceIndex: number;
}

export interface PresentModel {
  readonly cardState: PresentCardState;
  readonly publicLinks: readonly PresentPublicLink[];
  readonly mandatoryName: string | null;
  readonly cardOnlyFields: readonly PresentCardOnlyField[];
  readonly selectedCardOnlyCount: number;
}

export interface PresentCardOnlyField {
  readonly field: Exclude<BusinessCardField, 'name' | 'profileImage'>;
  readonly preferenceKey: PresentCardPreferenceKey;
  readonly values: readonly string[];
  readonly selected: boolean;
}

export type PresentCardPreferenceKey = Exclude<
  keyof ShareFieldPreferences,
  'shareProfileImage'
>;

export interface PresentCardPreset {
  readonly name: string;
  readonly preferenceKeys: readonly PresentCardPreferenceKey[];
}

export type PhysicalCardMaterial = 'steel' | 'blackTitanium' | 'brass';

/**
 * WP-B owns the Present-only preferences but cannot change the shared
 * preferences module while the other tab packages are working in parallel.
 * Optional augmentation keeps old `prefs:v1` payloads valid while routing all
 * new writes through `usePreferences.set`, so they use the same MMKV-backed
 * persistence and wipe behavior as the existing share toggles.
 */
declare module '@/settings/preferences' {
  interface Preferences {
    readonly presentCardPresets?: readonly PresentCardPreset[];
    readonly presentPhysicalCardMaterial?: PhysicalCardMaterial;
    readonly presentPhysicalCardEngraveName?: boolean;
    readonly presentPhysicalCardEngraveUsername?: boolean;
    readonly presentPhysicalCardEngraveQr?: boolean;
  }
}

const CARD_FIELD_PREFERENCE: Readonly<
  Record<PresentCardOnlyField['field'], PresentCardPreferenceKey>
> = {
  title: 'shareTitle',
  company: 'shareCompany',
  email: 'shareEmail',
  phone: 'sharePhone',
  socialNetworks: 'shareSocialNetworks',
  skills: 'shareSkills',
};

const CARD_FIELD_ORDER = [
  'title',
  'company',
  'email',
  'phone',
  'socialNetworks',
  'skills',
] as const satisfies readonly PresentCardOnlyField['field'][];

export const PRESENT_CARD_PREFERENCE_KEYS = CARD_FIELD_ORDER.map(
  (field) => CARD_FIELD_PREFERENCE[field]
);

export interface PresentCardStateInput {
  readonly detailsHydrated: boolean;
  readonly hasManifest: boolean;
  readonly card: BusinessCard | undefined;
  readonly hasError: boolean;
}

export type PresentAttestationsState = 'loading' | 'error' | 'empty' | 'ready';

export function resolvePresentAttestationsState(input: {
  readonly hydrated: boolean;
  readonly hasError: boolean;
  readonly claimCount: number;
}): PresentAttestationsState {
  if (input.hasError) return 'error';
  if (!input.hydrated) return 'loading';
  return input.claimCount > 0 ? 'ready' : 'empty';
}

export function resolvePresentCardState(input: PresentCardStateInput): PresentCardState {
  if (input.hasError) return { kind: 'error' };
  if (input.card) return { kind: 'ready', card: input.card };
  if (!input.detailsHydrated) return { kind: 'loading' };
  if (!input.hasManifest) return { kind: 'empty' };
  return { kind: 'error' };
}

export function buildPresentModel(input: PresentModelInput): PresentModel {
  const card = input.cardState.kind === 'ready' ? input.cardState.card : null;
  const enabledFields = new Set(
    enabledFieldsFromSharePreferences(input.preferences)
  );
  const cardOnlyFields = card === null
    ? []
    : CARD_FIELD_ORDER.flatMap((field): readonly PresentCardOnlyField[] => {
        const values = presentFieldValues(card, field);
        if (values.length === 0) return [];
        return [{
          field,
          preferenceKey: CARD_FIELD_PREFERENCE[field],
          values,
          selected: enabledFields.has(field),
        }];
      });

  return {
    cardState: input.cardState,
    publicLinks: input.links.flatMap((link, sourceIndex) =>
      visibilityAt(input.linkVisibility, sourceIndex) === 'public'
        ? [{ link, sourceIndex }]
        : []
    ),
    mandatoryName: card?.name.trim() ?? null,
    cardOnlyFields,
    selectedCardOnlyCount: cardOnlyFields.filter((field) => field.selected).length,
  };
}

function presentFieldValues(
  card: BusinessCard,
  field: PresentCardOnlyField['field']
): readonly string[] {
  switch (field) {
    case 'title':
    case 'company':
    case 'email':
    case 'phone': {
      const value = card[field]?.trim();
      return value ? [value] : [];
    }
    case 'socialNetworks':
      return card.socialNetworks.flatMap((social) => {
        const username = social.username.trim();
        return username ? [`${social.platform}: ${username}`] : [];
      });
    case 'skills':
      return card.skills.flatMap((skill) => {
        const name = skill.name.trim();
        return name ? [name] : [];
      });
  }
}
