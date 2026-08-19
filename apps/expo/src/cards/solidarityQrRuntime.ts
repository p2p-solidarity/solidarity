import type { BusinessCard } from '@solidarity/shared';

import { buildCrd1CardWire } from '@/cards/crd1Envelope';
import { encodeEnvelopeToWire, type EnvelopeWireResult } from '@/cards/qrEnvelope';
import {
  buildDidSignedEnvelope,
  buildSolidarityQrPayload,
  buildZKEnvelope,
  type ShareFieldPreferences,
  type SolidarityQrPayloadOptions,
} from '@/cards/solidarityQrPayload';
import {
  didKeyForCurrentIdentity,
  publicJwk,
  signJwt,
  signRawEs256,
} from '@/keychain/signingKey';

export interface RuntimeSolidarityQrOptions {
  readonly proofClaims?: readonly string[];
  /** Optional public page carried alongside the selected card snapshot. */
  readonly sealedRoute?: string;
}

/**
 * Produce the wire string the share screens drop into `<QRCode value/>`.
 *
 * Dispatches on `card.sharingPreferences.sharingFormat`, mirroring Swift's
 * `QRCodeGenerationService.buildEnvelope` + `encodeEnvelopeToImage`
 * (Services/Card/QRCodeGenerationService.swift L74-100, L233-247):
 *
 *   - 'plaintext' → JSON envelope (no compression, QR cascade starts at H).
 *   - 'zkProof'   → AES-GCM encrypted envelope, gzipped via `sce1:` framing
 *                   when that shrinks payload size; bare JSON otherwise.
 *   - 'didSigned' → bare VC JWT (envelope JSON wrapper would push past
 *                   QR limits for typical JWTs).
 *
 * On any failure (no signer, biometric cancelled, encryption error) we fall
 * back to the plaintext envelope so the share QR is never empty.
 */
export async function buildRuntimeSolidarityQrPayload(
  card: BusinessCard,
  shareFieldPreferences: ShareFieldPreferences,
  runtimeOptions: RuntimeSolidarityQrOptions = {}
): Promise<string> {
  return (await buildRuntimeSolidarityQrWire(card, shareFieldPreferences, runtimeOptions)).wire;
}

export async function buildRuntimeSolidarityQrWire(
  card: BusinessCard,
  shareFieldPreferences: ShareFieldPreferences,
  runtimeOptions: RuntimeSolidarityQrOptions = {}
): Promise<EnvelopeWireResult> {
  const options: SolidarityQrPayloadOptions = {
    sharingLevel: 'professional',
    shareFieldPreferences,
    proofClaims: runtimeOptions.proofClaims,
    sealedRoute: runtimeOptions.sealedRoute,
  };
  const format = card.sharingPreferences.sharingFormat;

  if (format === 'didSigned') {
    try {
      const [issuerDid, jwk] = await Promise.all([
        didKeyForCurrentIdentity(),
        publicJwk(),
      ]);
      const signer = {
        issuerDid,
        publicKeyJwk: jwk,
        signJwt,
        signRaw: async (message: Uint8Array) => (await signRawEs256(message)).signature,
      };
      // Preferred wire: CRD1 (CBOR→COSE_Sign1→zlib→Base45, EC-Q). Returns
      // null when the pack would exceed QR capacity — then the legacy bare
      // VC-JWT wire (below) keeps the share working, and every deployed
      // scanner keeps parsing both.
      const crd1 = await buildCrd1CardWire(card, { ...options, signer });
      if (crd1) return crd1;
      const envelope = await buildDidSignedEnvelope(card, { ...options, signer });
      if (envelope) return encodeEnvelopeToWire(envelope);
    } catch {
      // fall through to plaintext
    }
  }

  if (format === 'zkProof') {
    try {
      const envelope = await buildZKEnvelope(card, options);
      return encodeEnvelopeToWire(envelope);
    } catch {
      // fall through to plaintext
    }
  }

  return {
    wire: buildSolidarityQrPayload(card, options),
    startingLevel: 'H',
  };
}
