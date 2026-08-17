import {
  decodeJwtUnsafe,
  resolveDidKey,
  uuid,
  verifyJwtEs256,
} from '@solidarity/shared';

import { parseSdJwt } from './selectiveDisclosure';
import type { StoredCredential, TrustLevel } from './store';

export const VC_EXPORT_FILENAME = 'solidarity_vcs.json';

export interface VcExportWrapper {
  readonly version: number;
  readonly vcs: readonly string[];
}

export interface ImportCredentialJwtsOptions {
  readonly existingIds?: Iterable<string>;
  readonly addCredential: (credential: StoredCredential) => Promise<void>;
  readonly now?: Date;
}

export interface ImportCredentialJwtsResult {
  readonly imported: number;
  readonly skipped: number;
  /** Dropped: malformed, or a did:key issuer whose signature FAILED to verify
   *  (adversarial). Never enters the store. */
  readonly rejected: number;
  /** Imported but tagged `unverified`: issuer method unsupported / no issuer,
   *  so the signature could not be checked. Not presentable as evidence. */
  readonly unverified: number;
}

/**
 * Import trust decision, made BEFORE a credential can enter the store:
 *   - `verified`          — did:key issuer, signature checks out → trusted.
 *   - `unverified-issuer` — no issuer, or an issuer DID method we cannot
 *                           resolve/verify → import as clearly-unverified.
 *   - `invalid`           — malformed, or a did:key whose signature FAILED →
 *                           reject outright (a forged signature is adversarial).
 */
export type VcVerificationStatus = 'verified' | 'unverified-issuer' | 'invalid';

/**
 * Verify an imported credential's issuer signature. did:key issuers are
 * verified locally (no network); other methods are honestly reported as
 * unverifiable rather than assumed valid. SD-JWTs are checked on their issuer
 * segment (the disclosures are unsigned by design). Fail-closed: a signature
 * mismatch is `invalid`, never `verified`.
 */
export function verifyImportedCredential(rawJwt: string): VcVerificationStatus {
  let issuerSegment = rawJwt;
  if (rawJwt.includes('~')) {
    const parsed = parseSdJwt(rawJwt);
    if (!parsed.ok) return 'invalid';
    issuerSegment = parsed.value.issuerJwt;
  }

  let header: { readonly kid?: string };
  let payload: DecodedCredentialJwt;
  try {
    ({ header, payload } = decodeJwtUnsafe<DecodedCredentialJwt>(issuerSegment));
  } catch {
    return 'invalid';
  }

  const iss =
    nonEmptyString(payload.iss) ??
    nonEmptyString(header.kid?.split('#')[0]);
  if (!iss?.startsWith('did:key:')) return 'unverified-issuer';

  let jwk;
  try {
    jwk = resolveDidKey(iss);
  } catch {
    // A did:key that will not decode is not a supported issuer we can trust.
    return 'unverified-issuer';
  }
  try {
    verifyJwtEs256(issuerSegment, jwk);
    return 'verified';
  } catch {
    return 'invalid';
  }
}

interface DecodedCredentialJwt {
  readonly jti?: string;
  readonly iss?: string;
  readonly sub?: string;
  readonly iat?: number;
  readonly nbf?: number;
  readonly exp?: number;
  readonly vc?: {
    readonly type?: readonly string[] | string;
    readonly credentialSubject?: unknown;
  };
}

export function buildVcExportText(jwts: readonly string[]): string {
  const wrapper: VcExportWrapper = { version: 1, vcs: jwts };
  return JSON.stringify(wrapper, null, 2);
}

export function parseVcExportText(text: string): readonly string[] {
  const parsed = JSON.parse(text) as unknown;
  if (!isVcExportWrapper(parsed)) {
    throw new Error('Invalid VC export file: missing `vcs` array.');
  }
  return parsed.vcs;
}

export function storedCredentialFromJwt(
  rawJwt: string,
  now: Date = new Date(),
  status: VcVerificationStatus = 'verified'
): StoredCredential {
  const issuerSegment = rawJwt.includes('~')
    ? sdJwtIssuerSegment(rawJwt) ?? rawJwt
    : rawJwt;
  const { payload } = decodeJwtUnsafe<DecodedCredentialJwt>(issuerSegment);
  const vcTypes = credentialTypes(payload.vc?.type);
  const subject = pickRecord(payload.vc?.credentialSubject);
  const issuerDid = nonEmptyString(payload.iss) ?? 'unknown';
  const holderDid =
    nonEmptyString(payload.sub) ??
    nonEmptyString(subject?.['id']) ??
    issuerDid;
  const issuedAtSec = payload.iat ?? payload.nbf;
  const id = credentialId(payload.jti);
  const type = credentialStoreType(vcTypes);
  const verified = status === 'verified';

  return {
    id,
    type,
    title: credentialTitle(type, subject),
    issuerDid,
    holderDid,
    // An unverified import must never carry a real trust level — it has not
    // been cryptographically checked, so it floors at L1 and is tagged so the
    // presentation path can refuse it.
    trustLevel: verified ? trustLevelFor(type, issuerDid) : 'L1',
    rawJwt,
    issuedAt: new Date((issuedAtSec ?? Math.round(now.getTime() / 1000)) * 1000),
    ...(payload.exp ? { expiresAt: new Date(payload.exp * 1000) } : {}),
    metadataTags: verified
      ? metadataTagsFor(issuerDid)
      : [...metadataTagsFor(issuerDid), 'unverified'],
  };
}

export async function importCredentialJwts(
  jwts: readonly string[],
  options: ImportCredentialJwtsOptions
): Promise<ImportCredentialJwtsResult> {
  const seen = new Set(options.existingIds ?? []);
  let imported = 0;
  let skipped = 0;
  let rejected = 0;
  let unverified = 0;

  for (const jwt of jwts) {
    const status = verifyImportedCredential(jwt);
    if (status === 'invalid') {
      // Forged / malformed signature — never enters the store.
      rejected += 1;
      continue;
    }
    const credential = storedCredentialFromJwt(jwt, options.now, status);
    if (seen.has(credential.id)) {
      skipped += 1;
      continue;
    }
    await options.addCredential(credential);
    seen.add(credential.id);
    imported += 1;
    if (status === 'unverified-issuer') unverified += 1;
  }

  return { imported, skipped, rejected, unverified };
}

function sdJwtIssuerSegment(combined: string): string | null {
  const parsed = parseSdJwt(combined);
  return parsed.ok ? parsed.value.issuerJwt : null;
}

function isVcExportWrapper(value: unknown): value is VcExportWrapper {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { readonly vcs?: unknown };
  return Array.isArray(v.vcs) && v.vcs.every((item) => typeof item === 'string');
}

function credentialTypes(type: readonly string[] | string | undefined): readonly string[] {
  if (typeof type === 'string') return [type];
  return type ?? [];
}

function credentialId(jti: string | undefined): string {
  const stripped = jti?.replace(/^urn:uuid:/u, '').trim();
  return stripped && stripped.length > 0 ? stripped : uuid();
}

function credentialStoreType(types: readonly string[]): string {
  if (types.includes('BusinessCardCredential')) return 'business_card';
  if (types.includes('PassportCredential')) return 'passport';
  if (types.includes('StudentCredential')) return 'student';
  if (types.includes('SocialGraphCredential')) return 'social_graph';
  if (types.includes('GroupMembershipCredential')) return 'group_membership';
  return 'verifiable_credential';
}

function credentialTitle(
  type: string,
  subject: Readonly<Record<string, unknown>> | undefined
): string {
  const core = pickRecord(subject?.['subject_core']);
  const subjectName =
    nonEmptyString(core?.['name']) ??
    nonEmptyString(subject?.['name']);
  if (subjectName) return subjectName;
  switch (type) {
    case 'business_card':
      return 'Business Card';
    case 'passport':
      return 'Passport';
    case 'student':
      return 'Student Credential';
    case 'social_graph':
      return 'Social Graph';
    case 'group_membership':
      return 'Group Membership';
    default:
      return 'Verifiable Credential';
  }
}

function trustLevelFor(type: string, issuerDid: string): TrustLevel {
  if (type === 'passport' || /gov|passport/iu.test(issuerDid)) return 'L3';
  if (type === 'student' || type === 'group_membership' || type === 'social_graph') return 'L2';
  return 'L1';
}

function metadataTagsFor(issuerDid: string): readonly string[] {
  const tags = ['jwt_vc_json', 'imported'];
  if (issuerDid.startsWith('did:key:')) tags.push('did:key');
  return tags;
}

function pickRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
