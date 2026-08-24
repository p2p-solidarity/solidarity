import {
  uuid,
  type BusinessCard,
  type BusinessCardField,
  type PublicKeyJWK,
} from '@solidarity/shared';

import {
  buildSnapshot,
  formatSwiftFullIso8601,
  formatSwiftIso8601,
  nonEmptyTrimmed,
  pruneUndefined,
  resolveSelectedFields,
  sortFields,
  type BusinessCardSnapshotPayload,
  type QRCodeEnvelopePayload,
  type SolidarityQrPayloadOptions,
} from '@/cards/solidarityQrTypes';

export interface DidSignedResult {
  readonly jwt: string;
  readonly shareId: string;
  readonly createdAt: string;
  readonly expirationDate?: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly sharingLevel: NonNullable<SolidarityQrPayloadOptions['sharingLevel']>;
  readonly selectedFields: readonly BusinessCardField[];
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

/**
 * The unsigned claims assembly shared by BOTH wire formats: the legacy bare
 * VC-JWT and the CRD1 COSE_Sign1 evidence-pack framing. One claims builder,
 * two signatures — the payload a scanner reconstructs is identical either way.
 */
export interface DidSignedClaimsResult {
  readonly payload: Record<string, unknown>;
  readonly issuedAt: number;
  readonly shareId: string;
  readonly createdAt: string;
  readonly expirationDate?: string;
  readonly issuerDid: string;
  readonly holderDid: string;
  readonly sharingLevel: NonNullable<SolidarityQrPayloadOptions['sharingLevel']>;
  readonly selectedFields: readonly BusinessCardField[];
}

export function buildDidSignedClaims(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions
): DidSignedClaimsResult {
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
    nostrPointer: options.nostrPointer,
  });

  return {
    payload,
    issuedAt,
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

export async function buildDidSignedJwt(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions
): Promise<DidSignedResult> {
  const signer = options.signer;
  if (!signer) throw new Error('No signer available for didSigned payload');

  const claims = buildDidSignedClaims(card, options);
  const jwt = await signer.signJwt({ alg: 'ES256' }, claims.payload);
  return {
    jwt,
    shareId: claims.shareId,
    createdAt: claims.createdAt,
    expirationDate: claims.expirationDate,
    issuerDid: claims.issuerDid,
    holderDid: claims.holderDid,
    sharingLevel: claims.sharingLevel,
    selectedFields: claims.selectedFields,
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
  readonly nostrPointer?: { readonly npub: string; readonly relays: readonly string[] };
}): Record<string, unknown> {
  const fieldStatuses = buildSelfAttestedStatuses(args.attestedFields);
  const subject = buildCredentialSubject({
    holderDid: args.holderDid,
    snapshot: args.snapshot,
    publicKeyJwk: args.publicKeyJwk,
    fieldStatuses,
    nostrPointer: args.nostrPointer,
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
  readonly nostrPointer?: { readonly npub: string; readonly relays: readonly string[] };
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
    // CREDS §3.3 subscription pointer (05-spec §3 v1.1) — present only when
    // the sender's Nostr binding is verified at emit time. Unknown to old
    // scanners, which ignore it (additive, both wires).
    subscription: args.nostrPointer
      ? { nostr: { npub: args.nostrPointer.npub, relays: [...args.nostrPointer.relays] } }
      : undefined,
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
