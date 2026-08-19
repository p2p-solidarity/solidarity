/**
 * CRD1 card wire — the COSE_Sign1 replacement for the legacy bare-JWT
 * `didSigned` QR (CREDS.md §18). The claims payload is byte-for-byte the
 * SAME VC object `buildDidSignedJwt` signs (one claims builder, two
 * signatures), so a scanner reconstructs an identical card either way; only
 * the envelope, signature framing, and size change:
 *
 *   legacy: base64url JSON JWT            (~1.4× payload, EC level L)
 *   CRD1:   CBOR → COSE_Sign1 → zlib → Base45, EC level Q, ≤2,420 chars
 *
 * Fallback contract: `buildCrd1CardWire` returns null when the signer has no
 * raw-message capability, when the pack exceeds QR capacity, or when claim
 * assembly/signing fails — the runtime then falls back to the legacy JWT
 * wire (still emitted by `encodeEnvelopeToWire`, still parsed by every
 * scanner in the field). Old wires keep scanning forever; CRD1 is the
 * preferred emission, not a flag day.
 */
import {
  didKeyFromJwk,
  err,
  ok,
  CRD1_MAX_VALIDITY_SECONDS,
  decodeCrd1,
  encodeCrd1,
  type Crd1Claims,
  type PublicKeyJWK,
  type Result,
} from '@solidarity/shared';

import { buildDidSignedClaims } from '@/cards/didSignedCredentialPayload';
import type { EnvelopeWireResult } from '@/cards/qrEnvelope';
import type { SolidarityQrPayloadOptions } from '@/cards/solidarityQrTypes';
import type { BusinessCard } from '@solidarity/shared';

export interface Crd1CardWireResult extends EnvelopeWireResult {
  readonly chars: number;
  readonly qrVersion: number;
  readonly shareId: string;
}

/**
 * Build the CRD1 wire for a card share. Returns null (→ legacy-JWT fallback)
 * rather than throwing: a QR share must never fail outright because the
 * newer framing didn't fit or the signer lacks `signRaw`.
 */
export async function buildCrd1CardWire(
  card: BusinessCard,
  options: SolidarityQrPayloadOptions
): Promise<Crd1CardWireResult | null> {
  const signer = options.signer;
  const signRaw = signer?.signRaw;
  if (!signer || !signRaw) return null;

  try {
    const assembled = buildDidSignedClaims(card, options);
    const iat = assembled.issuedAt;
    const requestedExp = options.expirationDate
      ? Math.round(options.expirationDate.getTime() / 1000)
      : iat + CRD1_MAX_VALIDITY_SECONDS;
    const claims: Crd1Claims = {
      ...assembled.payload,
      iss: assembled.issuerDid,
      iat,
      exp: Math.min(requestedExp, iat + CRD1_MAX_VALIDITY_SECONDS),
    };
    const outcome = await encodeCrd1(claims, assembled.issuerDid, signRaw);
    if (!outcome.ok) return null;
    return {
      wire: outcome.wire,
      // CREDS.md §18: CRD1 targets QR alphanumeric mode at EC level Q.
      startingLevel: 'Q',
      chars: outcome.chars,
      qrVersion: outcome.qrVersion,
      shareId: assembled.shareId,
    };
  } catch {
    return null;
  }
}

export interface Crd1VerifiedWire {
  readonly claims: Crd1Claims;
  readonly did: string;
}

/**
 * Decode + verify a scanned CRD1 wire, then enforce the app-level holder
 * binding on top of the envelope checks `decodeCrd1` already ran (signature
 * under kid's did:key, iss === kid did, ≤30-day validity window): when the
 * claims embed a subject key (`vc.credentialSubject.subject_core
 * .publicKeyJwk` or `credentialSubject.publicKeyJwk`), that key must derive
 * exactly the did:key that signed the pack. A valid signature vouching for
 * someone ELSE's subject key is the holder-binding bug class progress.md
 * documents — it fails closed here, at the single scan entry point.
 */
export function verifyCrd1Wire(wire: string, now?: Date): Result<Crd1VerifiedWire, string> {
  const decoded = now ? decodeCrd1(wire, now) : decodeCrd1(wire);
  if (!decoded.ok) return decoded;
  const { claims, did } = decoded.value;

  const embedded = extractSubjectJwk(claims);
  if (embedded) {
    let embeddedDid: string;
    try {
      embeddedDid = didKeyFromJwk(embedded);
    } catch {
      return err('embedded subject key is malformed');
    }
    if (embeddedDid !== did) {
      return err('embedded subject key does not match the signing did');
    }
  }
  return ok(decoded.value);
}

function extractSubjectJwk(claims: Crd1Claims): PublicKeyJWK | null {
  const vc = pickRecord(claims['vc']);
  const subject = pickRecord(vc?.['credentialSubject']);
  if (!subject) return null;
  const fromCore = pickRecord(pickRecord(subject['subject_core'])?.['publicKeyJwk']);
  const raw = fromCore ?? pickRecord(subject['publicKeyJwk']);
  if (!raw) return null;
  const kty = raw['kty'];
  const crv = raw['crv'];
  const x = raw['x'];
  const y = raw['y'];
  if (kty !== 'EC' || crv !== 'P-256' || typeof x !== 'string' || typeof y !== 'string') {
    return null;
  }
  return { kty: 'EC', crv: 'P-256', alg: 'ES256', x, y };
}

function pickRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>;
  }
  return undefined;
}
