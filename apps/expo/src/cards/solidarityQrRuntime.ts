import type { BusinessCard } from '@solidarity/shared';

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
      const envelope = await buildDidSignedEnvelope(card, {
        ...options,
        signer: { issuerDid, publicKeyJwk: jwk, signJwt },
      });
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
