/**
 * Envelope handler — TS port of Swift `QRCodeScanService+Handlers.swift`
 * (decodeEnvelope + handleEnvelope + handleEncryptedPayload +
 * evaluateSharingPayload + handleDidSignedPayload). Routes a scanned QR
 * payload into one of:
 *   - `card`        → a rebuilt BusinessCard the receive sheet can present
 *   - `oidc-request` / `oidc-response` / `vp-token` → existing OIDC routes
 *   - `unknown`     → caller falls through to legacy classifier
 *   - `error`       → user-visible failure (expired / decryption / etc.)
 *
 * Verification chain mirrors Swift line-for-line:
 *   - plaintext envelope → no signature, `Unverified`
 *   - zkProof envelope   → decrypt, check expiry, lazy-verify sd/issuer proofs
 *   - didSigned envelope → verify JWT against embedded JWK
 */
import {
  decodeJwtUnsafe,
  uuid,
  verifyJwtEs256,
  type BusinessCard,
  type BusinessCardField,
  type PublicKeyJWK,
  type SocialNetwork,
  type SocialPlatform,
  type Skill,
  type VerificationStatus,
} from '@solidarity/shared';

import { decompressQR } from '@/cards/qrCompression';
import { verifyCrd1Wire } from '@/cards/crd1Envelope';
import { EVIDENCE_PACK_TYP } from '@/cards/evidencePack';
import { parseEnvelopeFromWire, decryptZKPayload } from '@/cards/qrEnvelope';
import type {
  QRCodeEnvelopePayload,
  QRPlaintextPayload,
  QRSharingPayload,
} from '@/cards/solidarityQrPayload';
import type { PassportShowScanResult } from '@/scan/showPresentationHandler';

export interface ScanOutcome {
  readonly kind:
    | 'card'
    | 'oidc-request'
    | 'oidc-response'
    | 'vp-token'
    | 'passport-show'
    | 'unknown'
    | 'error';
  readonly card?: BusinessCard;
  readonly verificationStatus?: VerificationStatus;
  readonly sealedRoute?: string;
  readonly oidcPayload?: string;
  readonly errorMessage?: string;
  readonly passportShow?: PassportShowScanResult;
}

const SUPPORTED_PROOF_CLAIMS = new Set(['is_human', 'age_over_18']);
const PASSPORT_SHOW_PRESENTATION_SCHEMA = 'gg.solidarity.passport.show-presentation.v1';

export async function handleScannedPayload(payload: string): Promise<ScanOutcome> {
  if (typeof payload !== 'string' || payload.length === 0) {
    return { kind: 'unknown' };
  }

  // OIDC URL fast-paths — mirror Swift QRCodeScanService.handleScannedString.
  if (
    payload.startsWith('openid4vp://') ||
    payload.startsWith('openid-vp://') ||
    payload.startsWith('openid-credential-offer://')
  ) {
    return { kind: 'oidc-request', oidcPayload: payload };
  }

  // App deep links — leave the existing deeplink router handle these.
  if (payload.startsWith('solidarity://') || payload.startsWith('airmeishi://')) {
    return { kind: 'unknown' };
  }

  // vCard — no parser exists yet; fall through to raw routing.
  if (payload.startsWith('BEGIN:VCARD')) {
    return { kind: 'unknown' };
  }

  // CRD1 evidence pack / card share — COSE_Sign1 wire, verified in full
  // (signature, iss↔kid binding, 30-day window, embedded-key holder binding)
  // before anything is rebuilt from it.
  if (payload.startsWith('CRD1:')) {
    return handleCrd1(payload);
  }

  // Passport show presentation (passport_show_v1) — fresh-proof ZK route.
  const passportShow = await maybeHandlePassportShowScan(payload);
  if (passportShow !== null) {
    return { kind: 'passport-show', passportShow };
  }

  const envelope = parseEnvelopeFromWire(payload);
  if (!envelope) return { kind: 'unknown' };

  switch (envelope.format) {
    case 'plaintext':
      return handlePlaintext(envelope);
    case 'zkProof':
      return handleZkProof(envelope);
    case 'didSigned':
      return handleDidSigned(envelope);
    default:
      return { kind: 'unknown' };
  }
}

async function maybeHandlePassportShowScan(
  payload: string
): Promise<PassportShowScanResult | null> {
  if (!looksLikePassportShowPayload(payload)) return null;
  const { handlePassportShowScan } = await import('@/scan/showPresentationHandler');
  return handlePassportShowScan(payload);
}

function looksLikePassportShowPayload(payload: string): boolean {
  if (payload.startsWith('{')) return payload.includes(PASSPORT_SHOW_PRESENTATION_SCHEMA);
  if (!payload.startsWith('sce1:')) return false;
  const decompressed = decompressQR(payload);
  if (!decompressed) return false;
  return new TextDecoder().decode(decompressed).includes(PASSPORT_SHOW_PRESENTATION_SCHEMA);
}

function handlePlaintext(envelope: QRCodeEnvelopePayload): ScanOutcome {
  const payload = envelope.plaintext;
  if (!payload) return { kind: 'error', errorMessage: 'Missing plaintext payload' };
  if (isExpired(payload.expirationDate)) {
    return { kind: 'error', errorMessage: 'Shared card has expired' };
  }
  const card = rebuildCardFromSnapshot(payload);
  return {
    kind: 'card',
    card,
    verificationStatus: 'Unverified',
    sealedRoute: payload.snapshot.sealedRoute,
  };
}

async function handleZkProof(envelope: QRCodeEnvelopePayload): Promise<ScanOutcome> {
  if (!envelope.encryptedPayload) {
    return { kind: 'error', errorMessage: 'Missing encrypted payload' };
  }
  const payload = await decryptZKPayload(envelope);
  if (!payload) return { kind: 'error', errorMessage: 'Failed to decrypt' };
  if (isExpired(payload.expirationDate)) {
    return { kind: 'error', errorMessage: 'Shared card has expired' };
  }
  if (
    typeof payload.maxUses === 'number' &&
    typeof payload.currentUses === 'number' &&
    payload.currentUses >= payload.maxUses
  ) {
    return { kind: 'error', errorMessage: 'Share link has reached maximum uses' };
  }

  const proofs = await verifyZkProofs(payload);
  const verificationStatus = resolveZkVerificationStatus(payload, proofs);
  const card = rebuildCardFromSharingPayload(payload);
  return {
    kind: 'card',
    card,
    verificationStatus,
    sealedRoute: payload.sealedRoute,
  };
}

/**
 * CRD1 wires come in two flavours sharing one verified envelope:
 *   - a card share: the SAME VC claims object the legacy JWT carried —
 *     rebuilt via `rebuildCardFromJwtPayload`, status Verified (the COSE
 *     signature + holder binding were already enforced by `verifyCrd1Wire`);
 *   - an evidence pack (`typ: gg.solidarity.evidence-pack.v1`): profile
 *     claims — rendered as a minimal contact card carrying the pack's links.
 * Anything failing verification is an error outcome, never an unverified card.
 */
function handleCrd1(wire: string): ScanOutcome {
  const verified = verifyCrd1Wire(wire);
  if (!verified.ok) {
    return { kind: 'error', errorMessage: `Invalid evidence pack (${verified.error})` };
  }
  const { claims, did } = verified.value;

  if (claims['typ'] === EVIDENCE_PACK_TYP) {
    const card = rebuildCardFromEvidencePack(claims, did);
    if (!card) return { kind: 'error', errorMessage: 'Missing evidence-pack subject' };
    return { kind: 'card', card, verificationStatus: 'Verified' };
  }

  const card = rebuildCardFromJwtPayload(claims, typeof claims['sub'] === 'string' ? claims['sub'] : did);
  if (!card) return { kind: 'error', errorMessage: 'Missing credential subject' };
  return { kind: 'card', card, verificationStatus: 'Verified' };
}

function rebuildCardFromEvidencePack(
  claims: Readonly<Record<string, unknown>>,
  did: string
): BusinessCard | null {
  const name = pickString(claims['name']);
  if (!name) return null;
  const rows = pickArray(claims['claims']) ?? [];
  const socialNetworks: SocialNetwork[] = rows
    .map((row) => pickRecord(row))
    .filter((row): row is Readonly<Record<string, unknown>> => Boolean(row))
    .map((row) => ({
      id: uuid(),
      platform: 'Website',
      username: pickString(row['label']) ?? pickString(row['value']) ?? '',
      url: pickString(row['value']),
    }));
  const now = new Date();
  void did;
  return {
    id: uuid(),
    name,
    title: undefined,
    company: undefined,
    email: undefined,
    phone: undefined,
    profileImage: undefined,
    animal: undefined,
    socialNetworks,
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(),
      professionalFields: new Set(),
      personalFields: new Set(),
      allowForwarding: true,
      expirationDate: undefined,
      useZK: false,
      sharingFormat: 'didSigned',
    },
    groupContext: undefined,
    verifiedFields: undefined,
    nameType: 'display_name',
    createdAt: now,
    updatedAt: now,
  };
}

function handleDidSigned(envelope: QRCodeEnvelopePayload): ScanOutcome {
  const signed = envelope.didSigned;
  if (!signed?.jwt) return { kind: 'error', errorMessage: 'Missing DID payload' };
  if (isExpired(signed.expirationDate)) {
    return { kind: 'error', errorMessage: 'Shared card has expired' };
  }

  const decoded = safeDecodeJwt(signed.jwt);
  if (!decoded) {
    return { kind: 'error', errorMessage: 'Malformed credential JWT' };
  }

  const jwk = extractPublicKeyJwk(decoded.header, decoded.payload);
  let verificationStatus: VerificationStatus = 'Unverified';
  if (jwk) {
    try {
      verifyJwtEs256(signed.jwt, jwk);
      verificationStatus = 'Verified';
    } catch {
      verificationStatus = 'Failed';
    }
  }

  const card = rebuildCardFromJwtPayload(decoded.payload, signed.holderDid);
  if (!card) return { kind: 'error', errorMessage: 'Missing credential subject' };
  return { kind: 'card', card, verificationStatus };
}

// ─── Verification helpers ──────────────────────────────────────────────────

interface ZkProofResult {
  readonly sdValid: boolean;
  readonly sdPresent: boolean;
  readonly issuerValid: boolean;
  readonly issuerPresent: boolean;
}

/**
 * Lazy-import `@/zk/proofManager` (parallel agent's port). Falls back to
 * "unverified" treatment when the module isn't shipped yet — never crashes.
 */
async function verifyZkProofs(payload: QRSharingPayload): Promise<ZkProofResult> {
  const result: ZkProofResult = {
    sdValid: false,
    sdPresent: payload.sdProof !== undefined,
    issuerValid: false,
    issuerPresent: payload.issuerProof !== undefined,
  };

  if (!result.sdPresent && !result.issuerPresent) return result;

  let sdValid = false;
  let issuerValid = false;

  if (payload.sdProof !== undefined) {
    try {
      const { verifySelectiveDisclosureProof } = await import('@/zk/proofManager');
      const outcome = await verifySelectiveDisclosureProof(
        payload.sdProof,
        payload.businessCard.cardId
      );
      sdValid = typeof outcome === 'boolean' ? outcome : outcome.isValid;
    } catch {
      // Treat verifier exceptions as unverified rather than failing the scan.
    }
  }

  if (payload.issuerProof !== undefined) {
    try {
      const { verifyGroupProof } = await import('@/zk/groupManager');
      const proofObject = safeJsonParse(payload.issuerProof) as
        | Parameters<typeof verifyGroupProof>[0]
        | null;
      if (proofObject) issuerValid = await verifyGroupProof(proofObject);
    } catch {
      // Treat verifier exceptions as unverified.
    }
  }

  return { ...result, sdValid, issuerValid };
}

function resolveZkVerificationStatus(
  payload: QRSharingPayload,
  proofs: ZkProofResult
): VerificationStatus {
  // Match Swift evaluateSharingPayload: any present proof that fails → Failed.
  if (proofs.sdPresent && !proofs.sdValid) return 'Failed';
  if (proofs.issuerPresent && !proofs.issuerValid) return 'Failed';

  const claims = payload.proofClaims;
  if (claims && claims.length > 0) {
    if (claims.some((claim) => !SUPPORTED_PROOF_CLAIMS.has(claim))) return 'Failed';
    if (claims.includes('is_human') && !proofs.issuerValid) return 'Failed';
    if (claims.includes('age_over_18') && !proofs.sdValid) return 'Failed';
  }

  if (proofs.sdValid || proofs.issuerValid) return 'Verified';
  return 'Unverified';
}

// ─── Card reconstruction helpers ───────────────────────────────────────────

/** Reverse of `buildSnapshot` — see solidarityQrPayload.ts line ~488. */
function rebuildCardFromSnapshot(payload: QRPlaintextPayload): BusinessCard {
  return rebuildCardFromBusinessCardSnapshot(payload.snapshot, payload.selectedFields);
}

function rebuildCardFromSharingPayload(payload: QRSharingPayload): BusinessCard {
  return rebuildCardFromBusinessCardSnapshot(
    payload.businessCard,
    payload.selectedFields ?? []
  );
}

function rebuildCardFromBusinessCardSnapshot(
  snapshot: QRPlaintextPayload['snapshot'],
  selectedFields: readonly BusinessCardField[]
): BusinessCard {
  const skills: Skill[] = snapshot.skills.map((s) => ({
    id: uuid(),
    name: s.name,
    category: s.category,
    proficiencyLevel: normaliseProficiency(s.proficiency),
  }));
  const socialNetworks: SocialNetwork[] = snapshot.socialProfiles.map((s) => ({
    id: uuid(),
    platform: normaliseSocialPlatform(s.platform),
    username: s.username,
    url: s.url,
  }));

  const fieldSet = new Set<BusinessCardField>(selectedFields);
  // Snapshot didn't carry sharing preferences — derive a minimal default
  // matching the on-wire selectedFields so the receive sheet can re-render
  // them consistently.
  const updatedAt = new Date(snapshot.updatedAt);
  return {
    id: snapshot.cardId,
    name: snapshot.name,
    title: snapshot.title,
    company: snapshot.company,
    email: snapshot.emails[0],
    phone: snapshot.phones[0],
    profileImage: snapshot.profileImageDataURI,
    animal: snapshot.animal?.id,
    socialNetworks,
    skills,
    categories: [...snapshot.categories],
    sharingPreferences: {
      publicFields: new Set(fieldSet),
      professionalFields: new Set(fieldSet),
      personalFields: new Set(fieldSet),
      allowForwarding: true,
      expirationDate: undefined,
      useZK: false,
      sharingFormat: 'plaintext',
    },
    groupContext: snapshot.groupContext,
    verifiedFields: undefined,
    nameType: snapshot.nameType,
    createdAt: updatedAt,
    updatedAt,
  };
}

function rebuildCardFromJwtPayload(
  payload: Readonly<Record<string, unknown>>,
  holderDidHint: string | undefined
): BusinessCard | null {
  const vc = pickRecord(payload['vc']) ?? pickRecord(payload['payload'])?.['vc'] as
    | Readonly<Record<string, unknown>>
    | undefined;
  const subject = pickRecord(vc?.['credentialSubject']);
  if (!subject) return null;

  const subjectCore = pickRecord(subject['subject_core']);
  const verifiedClaims = pickRecord(subject['verified_contact_claims']);
  const credentialMeta = pickRecord(subject['credential_meta']);
  const worksFor = pickRecord(subject['worksFor']) ?? pickRecord(verifiedClaims?.['worksFor']);
  const contactPoint = pickArray(subject['contactPoint']) ?? pickArray(verifiedClaims?.['contactPoint']);

  const name =
    pickString(subjectCore?.['name']) ??
    pickString(subject['name']) ??
    '';
  const cardId =
    pickString(subjectCore?.['businessCardId']) ??
    pickString(subject['businessCardId']) ??
    pickString(payload['jti'])?.replace(/^urn:uuid:/u, '') ??
    uuid();
  const title = pickString(subject['jobTitle']) ?? pickString(verifiedClaims?.['jobTitle']);
  const company = pickString(worksFor?.['name']);
  const email = pickFirstString(subject['email']) ?? pickFirstString(verifiedClaims?.['email']);
  const phone =
    pickFirstString(subject['telephone']) ??
    pickFirstString(verifiedClaims?.['telephone']);

  const socialNetworks: SocialNetwork[] = (contactPoint ?? [])
    .map((entry) => pickRecord(entry))
    .filter((entry): entry is Readonly<Record<string, unknown>> => Boolean(entry))
    .map((entry) => ({
      id: uuid(),
      platform: normaliseSocialPlatform(pickString(entry['contactType'])),
      username: pickString(entry['identifier']) ?? '',
      url: pickString(entry['url']),
    }));

  const updatedAtRaw =
    pickString(subject['updatedAt']) ?? pickString(credentialMeta?.['updatedAt']);
  const updatedAt = updatedAtRaw ? new Date(updatedAtRaw) : new Date();
  const nameTypeRaw = pickString(subjectCore?.['nameType']);
  const nameType: BusinessCard['nameType'] =
    nameTypeRaw === 'verified_legal_name' ? 'verified_legal_name' : 'display_name';

  void holderDidHint; // Reserved for future linkage to credential id.
  return {
    id: cardId,
    name,
    title,
    company,
    email,
    phone,
    profileImage: undefined,
    animal: undefined,
    socialNetworks,
    skills: [],
    categories: [],
    sharingPreferences: {
      publicFields: new Set(),
      professionalFields: new Set(),
      personalFields: new Set(),
      allowForwarding: true,
      expirationDate: undefined,
      useZK: false,
      sharingFormat: 'didSigned',
    },
    groupContext: undefined,
    verifiedFields: undefined,
    nameType,
    createdAt: updatedAt,
    updatedAt,
  };
}

// ─── JWT helpers ───────────────────────────────────────────────────────────

function safeDecodeJwt(jwt: string): {
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
} | null {
  try {
    const decoded = decodeJwtUnsafe<Readonly<Record<string, unknown>>>(jwt);
    return {
      header: decoded.header as unknown as Readonly<Record<string, unknown>>,
      payload: decoded.payload,
    };
  } catch {
    return null;
  }
}

function extractPublicKeyJwk(
  header: Readonly<Record<string, unknown>>,
  payload: Readonly<Record<string, unknown>>
): PublicKeyJWK | null {
  const fromHeader = pickRecord(header['jwk']);
  if (fromHeader) {
    const parsed = validateJwk(fromHeader);
    if (parsed) return parsed;
  }
  const vc = pickRecord(payload['vc']) ?? pickRecord(pickRecord(payload['payload'])?.['vc']);
  const subject = pickRecord(vc?.['credentialSubject']);
  if (!subject) return null;
  const fromCore = pickRecord(pickRecord(subject['subject_core'])?.['publicKeyJwk']);
  if (fromCore) {
    const parsed = validateJwk(fromCore);
    if (parsed) return parsed;
  }
  const fromSubject = pickRecord(subject['publicKeyJwk']);
  if (fromSubject) return validateJwk(fromSubject);
  return null;
}

function validateJwk(raw: Readonly<Record<string, unknown>>): PublicKeyJWK | null {
  const kty = pickString(raw['kty']);
  const crv = pickString(raw['crv']);
  const x = pickString(raw['x']);
  const y = pickString(raw['y']);
  if (kty !== 'EC' || crv !== 'P-256' || !x || !y) return null;
  return {
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    x,
    y,
  };
}

// ─── Small helpers ─────────────────────────────────────────────────────────

function isExpired(iso: string | undefined): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return false;
  return ts < Date.now();
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function pickRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}

function pickArray(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const PROFICIENCY_LEVELS: readonly Skill['proficiencyLevel'][] = [
  'Beginner',
  'Intermediate',
  'Advanced',
  'Expert',
];

function normaliseProficiency(raw: string): Skill['proficiencyLevel'] {
  return PROFICIENCY_LEVELS.includes(raw as Skill['proficiencyLevel'])
    ? (raw as Skill['proficiencyLevel'])
    : 'Intermediate';
}

const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  'LinkedIn',
  'Twitter',
  'Instagram',
  'Facebook',
  'GitHub',
  'Website',
  'Other',
];

function normaliseSocialPlatform(raw: string | undefined): SocialPlatform {
  if (!raw) return 'Other';
  return SOCIAL_PLATFORMS.includes(raw as SocialPlatform)
    ? (raw as SocialPlatform)
    : 'Other';
}

function pickFirstString(value: unknown): string | undefined {
  if (typeof value === 'string') return pickString(value);
  if (Array.isArray(value)) {
    const first = value.find((v): v is string => typeof v === 'string');
    return first ? pickString(first) : undefined;
  }
  return undefined;
}
