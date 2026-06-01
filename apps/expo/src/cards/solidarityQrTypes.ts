import {
  effectiveFields,
  type BusinessCard,
  type BusinessCardField,
  type PublicKeyJWK,
  type SharingLevel,
} from '@solidarity/shared';

import type { Preferences } from '@/settings/preferences';
import type { SelectiveDisclosureProof } from '@/zk/proofManager';

export type { SelectiveDisclosureProof } from '@/zk/proofManager';

export type ShareFieldPreferences = Pick<
  Preferences,
  | 'shareTitle'
  | 'shareCompany'
  | 'shareEmail'
  | 'sharePhone'
  | 'shareProfileImage'
  | 'shareSocialNetworks'
  | 'shareSkills'
>;

export interface SolidarityQrPayloadOptions {
  readonly sharingLevel?: SharingLevel;
  readonly shareFieldPreferences?: ShareFieldPreferences;
  readonly proofClaims?: readonly string[];
  readonly now?: Date;
  readonly shareId?: string;
  readonly credentialId?: string;
  readonly expirationDate?: Date;
  readonly sealedRoute?: string;
  readonly signer?: SolidarityQrSigner;
}

export interface SolidarityQrSigner {
  readonly issuerDid: string;
  readonly holderDid?: string;
  readonly publicKeyJwk: PublicKeyJWK;
  readonly signJwt: (
    header: { readonly alg: 'ES256'; readonly typ?: string; readonly kid?: string },
    payload: Readonly<Record<string, unknown>>
  ) => Promise<string>;
}

export interface BusinessCardSnapshotPayload {
  readonly cardId: string;
  readonly name: string;
  readonly nameType: BusinessCard['nameType'];
  readonly title?: string;
  readonly company?: string;
  readonly emails: readonly string[];
  readonly phones: readonly string[];
  readonly skills: readonly {
    readonly name: string;
    readonly category: string;
    readonly proficiency: string;
  }[];
  readonly socialProfiles: readonly {
    readonly platform: string;
    readonly username: string;
    readonly url?: string;
  }[];
  readonly categories: readonly string[];
  readonly animal?: {
    readonly id: NonNullable<BusinessCard['animal']>;
    readonly displayName: string;
  };
  readonly updatedAt: string;
  readonly profileImageDataURI?: string;
  readonly summary?: string;
  readonly groupContext?: BusinessCard['groupContext'];
  readonly sealedRoute?: string;
}

export interface QRPlaintextPayload {
  readonly snapshot: BusinessCardSnapshotPayload;
  readonly shareId: string;
  readonly createdAt: string;
  readonly expirationDate?: string;
  readonly proofClaims?: readonly string[];
  readonly selectedFields: readonly BusinessCardField[];
}

export interface QRDidSignedPayload {
  readonly jwt: string;
  readonly shareId: string;
  readonly createdAt: string;
  readonly expirationDate?: string;
  readonly issuerDid: string;
  readonly holderDid: string;
}

export type SharingFormat = 'plaintext' | 'zkProof' | 'didSigned';

export interface QRCodeEnvelopePayload {
  readonly version: 2;
  readonly format: SharingFormat;
  readonly sharingLevel: SharingLevel;
  readonly selectedFields: readonly BusinessCardField[];
  readonly shareId: string;
  readonly plaintext?: QRPlaintextPayload;
  readonly encryptedPayload?: string;
  readonly didSigned?: QRDidSignedPayload;
}

export interface QRSharingPayload {
  readonly businessCard: BusinessCardSnapshotPayload;
  readonly sharingLevel: SharingLevel;
  readonly selectedFields?: readonly BusinessCardField[];
  readonly scope?: string;
  readonly expirationDate: string;
  readonly shareId: string;
  readonly createdAt: string;
  readonly maxUses?: number;
  readonly currentUses?: number;
  readonly issuerCommitment?: string;
  readonly issuerProof?: string;
  readonly sdProof?: SelectiveDisclosureProof;
  readonly format?: SharingFormat;
  readonly sealedRoute?: string;
  readonly proofClaims?: readonly string[];
}

const SHARE_FIELD_ORDER: readonly BusinessCardField[] = [
  'name',
  'title',
  'company',
  'email',
  'phone',
  'profileImage',
  'socialNetworks',
  'skills',
];

const ANIMAL_DISPLAY_NAME: Readonly<
  Record<NonNullable<BusinessCard['animal']>, string>
> = {
  dog: 'Dog',
  horse: 'Horse',
  pig: 'Pig',
  sheep: 'Sheep',
  dove: 'Dove',
};

export function enabledFieldsFromSharePreferences(
  prefs: ShareFieldPreferences
): readonly BusinessCardField[] {
  const fields = new Set<BusinessCardField>(['name']);
  if (prefs.shareTitle) fields.add('title');
  if (prefs.shareCompany) fields.add('company');
  if (prefs.shareEmail) fields.add('email');
  if (prefs.sharePhone) fields.add('phone');
  if (prefs.shareProfileImage) fields.add('profileImage');
  if (prefs.shareSocialNetworks) fields.add('socialNetworks');
  if (prefs.shareSkills) fields.add('skills');
  return sortFields(fields);
}

export function shareFieldPreferencesFromFields(
  fields: Iterable<string>
): ShareFieldPreferences {
  const enabled = new Set(sortFields(fields));
  return {
    shareTitle: enabled.has('title'),
    shareCompany: enabled.has('company'),
    shareEmail: enabled.has('email'),
    sharePhone: enabled.has('phone'),
    shareProfileImage: enabled.has('profileImage'),
    shareSocialNetworks: enabled.has('socialNetworks'),
    shareSkills: enabled.has('skills'),
  };
}

export function resolveSelectedFields(
  card: BusinessCard,
  sharingLevel: SharingLevel,
  options: SolidarityQrPayloadOptions
): readonly BusinessCardField[] {
  const fields = options.shareFieldPreferences
    ? enabledFieldsFromSharePreferences(options.shareFieldPreferences)
    : sortFields(effectiveFields(card.sharingPreferences, sharingLevel));

  return fields.filter((field) => field !== 'profileImage');
}

export function buildSnapshot(
  card: BusinessCard,
  selectedFields: readonly BusinessCardField[],
  sealedRoute: string | undefined
): BusinessCardSnapshotPayload {
  const fields = new Set(selectedFields);
  const title = fields.has('title') ? nonEmptyTrimmed(card.title) : undefined;
  const company = fields.has('company') ? nonEmptyTrimmed(card.company) : undefined;
  const summary = buildSummary(title, company);

  return {
    cardId: card.id,
    name: fields.has('name') ? card.name : '',
    nameType: card.nameType,
    title,
    company,
    emails: fields.has('email') ? compactTrimmed([card.email]) : [],
    phones: fields.has('phone') ? compactTrimmed([card.phone]) : [],
    skills: fields.has('skills')
      ? card.skills.map((skill) => ({
          name: skill.name,
          category: skill.category,
          proficiency: skill.proficiencyLevel,
        }))
      : [],
    socialProfiles: fields.has('socialNetworks')
      ? card.socialNetworks.map((profile) => ({
          platform: profile.platform,
          username: profile.username,
          url: profile.url,
        }))
      : [],
    categories: card.categories,
    animal: card.animal
      ? { id: card.animal, displayName: ANIMAL_DISPLAY_NAME[card.animal] }
      : undefined,
    updatedAt: formatSwiftIso8601(card.updatedAt),
    summary,
    groupContext: card.groupContext,
    sealedRoute,
  };
}

export function sortFields(fields: Iterable<string>): readonly BusinessCardField[] {
  const valid = new Set<BusinessCardField>();
  for (const field of fields) {
    if (SHARE_FIELD_ORDER.includes(field as BusinessCardField)) {
      valid.add(field as BusinessCardField);
    }
  }
  return Array.from(valid).sort((a, b) => a.localeCompare(b));
}

export function formatSwiftIso8601(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

export function formatSwiftFullIso8601(date: Date): string {
  return date.toISOString();
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
}

export function pruneUndefined(
  value: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

function compactTrimmed(values: readonly (string | undefined)[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = nonEmptyTrimmed(value);
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function buildSummary(
  title: string | undefined,
  company: string | undefined
): string | undefined {
  if (title && company) return `${title} @ ${company}`;
  return title ?? company;
}

function normalizeForJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value instanceof Date) return formatSwiftIso8601(value);
  if (Array.isArray(value)) return value.map(normalizeForJson);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeForJson(
        (value as Readonly<Record<string, unknown>>)[key]
      );
      if (normalized !== undefined) out[key] = normalized;
    }
    return out;
  }
  return value;
}
