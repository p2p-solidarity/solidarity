import {
  effectiveFields,
  uuid,
  type BusinessCard,
  type BusinessCardField,
  type PublicKeyJWK,
  type SharingLevel,
} from '@solidarity/shared';

import type { Preferences } from '@/settings/preferences';

// Lazy-loaded so this module stays importable from environments (notably
// Bun's unit-test loader) that haven't installed an `expo-secure-store` shim.
// `encryptionManager` transitively pulls in `react-native`, which trips Bun's
// flow-syntax parser without a mock.
import type * as EncryptionManagerModuleNs from '@/storage/encryptionManager';
type EncryptionManagerModule = typeof EncryptionManagerModuleNs;
let encryptionManagerCache: EncryptionManagerModule | null = null;
async function loadEncryptionManager(): Promise<EncryptionManagerModule> {
  encryptionManagerCache ??= await import('@/storage/encryptionManager');
  return encryptionManagerCache;
}

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

interface BusinessCardSnapshotPayload {
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

// Opaque pass-through until ProofGenerationManager lands in RN.
export interface SelectiveDisclosureProof {
  readonly _placeholder?: never;
}

// Mirrors Swift QRSharingPayload (Services/Card/QRCodeModels.swift L95-147).
// Proof fields (issuerProof, sdProof) intentionally left null/undefined —
// ProofGenerationManager port is out of scope for this task.
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
  fields: Iterable<BusinessCardField | string>
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

export function buildSolidarityQrPayload(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): string {
  const sharingLevel = options.sharingLevel ?? 'professional';
  const shareId = options.shareId ?? uuid();
  const selectedFields = resolveSelectedFields(card, sharingLevel, options);
  const envelope: QRCodeEnvelopePayload = {
    version: 2,
    format: 'plaintext',
    sharingLevel,
    selectedFields,
    shareId,
    plaintext: {
      snapshot: buildSnapshot(card, selectedFields, options.sealedRoute),
      shareId,
      createdAt: formatSwiftIso8601(options.now ?? new Date()),
      expirationDate: options.expirationDate
        ? formatSwiftIso8601(options.expirationDate)
        : undefined,
      selectedFields,
    },
  };
  return stableStringify(envelope);
}

export async function buildSolidarityQrPayloadAsync(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): Promise<string> {
  if (card.sharingPreferences.sharingFormat === 'didSigned' && options.signer) {
    try {
      const signed = await buildDidSignedJwt(card, options);
      return signed.jwt;
    } catch {
      return buildSolidarityQrPayload(card, options);
    }
  }
  return buildSolidarityQrPayload(card, options);
}

/**
 * Build a zkProof envelope mirroring Swift `buildZKEnvelope`
 * (Services/Card/QRCodeGenerationService.swift L281-353).
 *
 * Same-sender escrow: `encryptJson` uses the user's master key, so the
 * recipient must hold the same key (synced via iCloud Keychain on iOS, or
 * explicitly restored from backup). Proof fields (issuerProof, sdProof,
 * proofClaims) are left undefined until ProofGenerationManager lands in RN.
 */
export async function buildZKEnvelope(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): Promise<QRCodeEnvelopePayload> {
  const sharingLevel = options.sharingLevel ?? 'professional';
  const shareId = options.shareId ?? uuid();
  const selectedFields = resolveSelectedFields(card, sharingLevel, options);
  const now = options.now ?? new Date();
  // Swift default: now + 24h. Mirror that so unset expirations don't last forever.
  const expirationDate =
    options.expirationDate ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const sharingPayload: QRSharingPayload = {
    businessCard: buildSnapshot(card, selectedFields, options.sealedRoute),
    sharingLevel,
    selectedFields,
    expirationDate: formatSwiftIso8601(expirationDate),
    shareId,
    createdAt: formatSwiftIso8601(now),
    format: 'zkProof',
    sealedRoute: options.sealedRoute,
  };

  const { encryptJson } = await loadEncryptionManager();
  const encryptedPayload = await encryptJson(sharingPayload);
  return {
    version: 2,
    format: 'zkProof',
    sharingLevel,
    selectedFields,
    shareId,
    encryptedPayload,
  };
}

export async function buildDidSignedEnvelope(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions = {}
): Promise<QRCodeEnvelopePayload | null> {
  if (!options.signer) return null;

  const signed = await buildDidSignedJwt(card, options);
  return {
    version: 2,
    format: 'didSigned',
    sharingLevel: signed.sharingLevel,
    selectedFields: signed.selectedFields,
    shareId: signed.shareId,
    didSigned: {
      jwt: signed.jwt,
      shareId: signed.shareId,
      createdAt: signed.createdAt,
      expirationDate: signed.expirationDate,
      issuerDid: signed.issuerDid,
      holderDid: signed.holderDid,
    },
  };
}

function resolveSelectedFields(
  card: BusinessCard,
  sharingLevel: SharingLevel,
  options: SolidarityQrPayloadOptions
): readonly BusinessCardField[] {
  const fields = options.shareFieldPreferences
    ? enabledFieldsFromSharePreferences(options.shareFieldPreferences)
    : sortFields(effectiveFields(card.sharingPreferences, sharingLevel));

  return fields.filter((field) => field !== 'profileImage');
}

interface DidSignedResult {
  readonly jwt: string;
  readonly shareId: string;
  readonly createdAt: string;
  readonly expirationDate?: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly sharingLevel: SharingLevel;
  readonly selectedFields: readonly BusinessCardField[];
}

async function buildDidSignedJwt(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions
): Promise<DidSignedResult> {
  const signer = options.signer;
  if (!signer) throw new Error('No signer available for didSigned payload');

  const sharingLevel = options.sharingLevel ?? 'professional';
  const selectedFields = resolveSelectedFields(card, sharingLevel, options);
  const vcEligibleFields = selectedFields.filter(
    (field) => field !== 'profileImage' && field !== 'skills'
  );
  const snapshot = buildSnapshot(card, vcEligibleFields, undefined);
  const credentialId = options.credentialId ?? uuid();
  const now = options.now ?? new Date();
  const issuedAt = Math.round(now.getTime() / 1000);
  const holderDid = signer.holderDid ?? signer.issuerDid;

  const payload = buildBusinessCardCredentialPayload({
    credentialId,
    issuerDid: signer.issuerDid,
    holderDid,
    issuedAt,
    expirationDate: options.expirationDate,
    snapshot,
    publicKeyJwk: signer.publicKeyJwk,
    attestedFields: vcEligibleFields,
  });

  const jwt = await signer.signJwt({ alg: 'ES256' }, payload);
  return {
    jwt,
    shareId: options.shareId ?? uuid(),
    createdAt: formatSwiftIso8601(now),
    expirationDate: options.expirationDate
      ? formatSwiftIso8601(options.expirationDate)
      : undefined,
    issuerDid: signer.issuerDid,
    holderDid,
    sharingLevel,
    selectedFields,
  };
}

function buildBusinessCardCredentialPayload(args: {
  readonly credentialId: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly issuedAt: number;
  readonly expirationDate?: Date;
  readonly snapshot: BusinessCardSnapshotPayload;
  readonly publicKeyJwk: PublicKeyJWK;
  readonly attestedFields: readonly BusinessCardField[];
}): Record<string, unknown> {
  const fieldStatuses = buildSelfAttestedStatuses(args.attestedFields);
  const subject = buildCredentialSubject({
    holderDid: args.holderDid,
    snapshot: args.snapshot,
    publicKeyJwk: args.publicKeyJwk,
    fieldStatuses,
  });

  return pruneUndefined({
    jti: `urn:uuid:${args.credentialId}`,
    iss: args.issuerDid,
    sub: args.holderDid,
    nbf: args.issuedAt,
    iat: args.issuedAt,
    exp: args.expirationDate
      ? Math.round(args.expirationDate.getTime() / 1000)
      : undefined,
    vc: {
      '@context': [
        'https://www.w3.org/2018/credentials/v1',
        'https://schema.org',
      ],
      type: ['VerifiableCredential', 'BusinessCardCredential'],
      credentialSubject: subject,
    },
  });
}

function buildCredentialSubject(args: {
  readonly holderDid: string;
  readonly snapshot: BusinessCardSnapshotPayload;
  readonly publicKeyJwk: PublicKeyJWK;
  readonly fieldStatuses: Record<string, string>;
}): Record<string, unknown> {
  const { snapshot } = args;
  const worksFor = snapshot.company
    ? { '@type': 'Organization', name: snapshot.company }
    : undefined;
  const email = snapshot.emails.length > 0 ? snapshot.emails : undefined;
  const telephone = snapshot.phones.length > 0 ? snapshot.phones : undefined;
  const contactPoint =
    snapshot.socialProfiles.length > 0
      ? snapshot.socialProfiles.map((profile) =>
          pruneUndefined({
            '@type': 'ContactPoint',
            contactType: profile.platform,
            identifier: profile.username,
            url: nonEmptyTrimmed(profile.url),
          })
        )
      : undefined;

  const verifiedContactClaims =
    snapshot.title || worksFor || email || telephone || contactPoint
      ? pruneUndefined({
          jobTitle: snapshot.title,
          worksFor,
          email,
          telephone,
          contactPoint,
          fieldStatuses: args.fieldStatuses,
        })
      : undefined;

  return pruneUndefined({
    id: args.holderDid,
    '@type': ['Person', 'BusinessCardSubject'],
    subject_core: {
      name: snapshot.name,
      nameType: snapshot.nameType,
      nameVerificationStatus: args.fieldStatuses['name'] ?? 'self_attested',
      businessCardId: snapshot.cardId,
      publicKeyJwk: args.publicKeyJwk,
    },
    verified_contact_claims: verifiedContactClaims,
    credential_meta: pruneUndefined({
      schemaVersion: 2,
      updatedAt: formatSwiftFullIso8601(new Date(snapshot.updatedAt)),
      groupContext: snapshot.groupContext,
    }),
    name: snapshot.name,
    summary: snapshot.summary,
    jobTitle: snapshot.title,
    worksFor,
    email,
    telephone,
    sameAs: snapshot.socialProfiles
      .map((profile) => nonEmptyTrimmed(profile.url))
      .filter((url): url is string => Boolean(url)),
    contactPoint,
    businessCardId: snapshot.cardId,
    updatedAt: formatSwiftFullIso8601(new Date(snapshot.updatedAt)),
    publicKeyJwk: args.publicKeyJwk,
    groupContext: snapshot.groupContext,
  });
}

function buildSelfAttestedStatuses(
  fields: readonly BusinessCardField[]
): Record<string, string> {
  const active = new Set<BusinessCardField>(fields);
  active.add('name');
  const out: Record<string, string> = {};
  for (const field of sortFields(active)) {
    out[field] = 'self_attested';
  }
  return out;
}

function buildSnapshot(
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

function sortFields(
  fields: Iterable<BusinessCardField | string>
): readonly BusinessCardField[] {
  const valid = new Set<BusinessCardField>();
  for (const field of fields) {
    if (SHARE_FIELD_ORDER.includes(field as BusinessCardField)) {
      valid.add(field as BusinessCardField);
    }
  }
  return Array.from(valid).sort((a, b) => a.localeCompare(b));
}

function compactTrimmed(values: readonly (string | undefined)[]): readonly string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = nonEmptyTrimmed(value);
    if (trimmed) out.push(trimmed);
  }
  return out;
}

function nonEmptyTrimmed(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildSummary(
  title: string | undefined,
  company: string | undefined
): string | undefined {
  if (title && company) return `${title} @ ${company}`;
  return title ?? company;
}

/** @internal — shared with `qrEnvelope.ts`. */
export function formatSwiftIso8601(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

function formatSwiftFullIso8601(date: Date): string {
  return date.toISOString();
}

/** @internal — shared with `qrEnvelope.ts`. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value));
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

function pruneUndefined<T extends Readonly<Record<string, unknown>>>(
  value: T
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}
