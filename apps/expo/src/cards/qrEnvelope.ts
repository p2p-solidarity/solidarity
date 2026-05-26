/**
 * QR envelope wire format — TS port of Swift
 * `QRCodeGenerationService.encodeEnvelopeToImage` (L74-100) plus the inverse
 * recogniser the scanner uses to route a scanned string into a typed envelope.
 *
 * Consumers:
 *   - `buildRuntimeSolidarityQrPayload` calls `encodeEnvelopeToWire` to turn
 *     an envelope into the wire string + correction-level hint.
 *   - `parseEnvelopeFromWire` is the entry point future scanner code will
 *     hit before deciding whether to call `decryptZKPayload` (zkProof) or
 *     verify the JWT (didSigned).
 */
import { decodeJwtUnsafe, utf8ToBytes, uuid } from '@solidarity/shared';

import { compressForQR, decompressQR } from '@/cards/qrCompression';
import {
  formatSwiftIso8601,
  stableStringify,
  type QRCodeEnvelopePayload,
  type QRSharingPayload,
} from '@/cards/solidarityQrPayload';

// Lazy-loaded mirror of the same pattern in solidarityQrPayload.ts —
// keeps this module importable from Bun's unit-test loader.
import type * as EncryptionManagerModuleNs from '@/storage/encryptionManager';
type EncryptionManagerModule = typeof EncryptionManagerModuleNs;
let encryptionManagerCache: EncryptionManagerModule | null = null;
async function loadEncryptionManager(): Promise<EncryptionManagerModule> {
  encryptionManagerCache ??= await import('@/storage/encryptionManager');
  return encryptionManagerCache;
}

export interface EnvelopeWireResult {
  readonly wire: string;
  readonly startingLevel: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Encode an envelope into the wire string + QR error-correction hint that
 * Swift's `encodeEnvelopeToImage` produces (L74-100 of
 * QRCodeGenerationService.swift). Caller drops `wire` into `<QRCode value/>`
 * and passes `startingLevel` to `generateQrPng` for the cascading encoder.
 *
 * - didSigned (bare JWT): start at 'L' (long already, max capacity headroom).
 * - zkProof (compressed): try `sce1:` compression; fall back to raw JSON
 *   when compression isn't smaller. Start at 'M'.
 * - plaintext (JSON): start at 'H'; Swift does not compress plaintext.
 */
export function encodeEnvelopeToWire(
  envelope: QRCodeEnvelopePayload
): EnvelopeWireResult {
  if (envelope.format === 'didSigned' && envelope.didSigned?.jwt) {
    return { wire: envelope.didSigned.jwt, startingLevel: 'L' };
  }
  const json = stableStringify(envelope);
  if (envelope.format === 'zkProof') {
    const compressed = compressForQR(utf8ToBytes(json));
    return { wire: compressed ?? json, startingLevel: 'M' };
  }
  return { wire: json, startingLevel: 'H' };
}

/**
 * Inverse of `encodeEnvelopeToWire`: recognise the wire shape (bare JWT,
 * `sce1:` compressed envelope, or plain JSON envelope) and return a
 * `QRCodeEnvelopePayload`. Returns null when the input doesn't match any
 * Solidarity wire format. Decryption of `zkProof.encryptedPayload` is a
 * separate step — see `decryptZKPayload`.
 */
export function parseEnvelopeFromWire(
  wire: string
): QRCodeEnvelopePayload | null {
  if (typeof wire !== 'string' || wire.length === 0) return null;

  if (wire.startsWith('eyJ') && wire.split('.').length === 3) {
    return synthesiseDidSignedEnvelope(wire);
  }

  if (wire.startsWith('sce1:')) {
    const decompressed = decompressQR(wire);
    if (!decompressed) return null;
    try {
      return JSON.parse(new TextDecoder().decode(decompressed)) as QRCodeEnvelopePayload;
    } catch {
      return null;
    }
  }

  if (wire.startsWith('{')) {
    try {
      return JSON.parse(wire) as QRCodeEnvelopePayload;
    } catch {
      return null;
    }
  }

  return null;
}

function synthesiseDidSignedEnvelope(jwt: string): QRCodeEnvelopePayload | null {
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwtUnsafe<Record<string, unknown>>(jwt).payload;
  } catch {
    return null;
  }
  const jtiRaw = payload['jti'];
  const issRaw = payload['iss'];
  const subRaw = payload['sub'];
  const expRaw = payload['exp'];
  const iatRaw = payload['iat'];
  const jti = typeof jtiRaw === 'string' ? jtiRaw : '';
  const shareId = jti.startsWith('urn:uuid:')
    ? jti.slice('urn:uuid:'.length)
    : (jti || uuid());
  const issuerDid = typeof issRaw === 'string' ? issRaw : '';
  const holderDid = typeof subRaw === 'string' ? subRaw : issuerDid;
  const exp = typeof expRaw === 'number' ? expRaw : undefined;
  const iat = typeof iatRaw === 'number' ? iatRaw : Math.round(Date.now() / 1000);
  return {
    version: 2,
    format: 'didSigned',
    sharingLevel: 'public',
    selectedFields: [],
    shareId,
    didSigned: {
      jwt,
      shareId,
      createdAt: formatSwiftIso8601(new Date(iat * 1000)),
      expirationDate: exp ? formatSwiftIso8601(new Date(exp * 1000)) : undefined,
      issuerDid,
      holderDid,
    },
  };
}

/**
 * Decrypt the `encryptedPayload` of a zkProof envelope back into the
 * `QRSharingPayload`. Only valid for `format === 'zkProof'`. Returns null
 * on missing ciphertext or decryption failure.
 */
export async function decryptZKPayload(
  envelope: QRCodeEnvelopePayload
): Promise<QRSharingPayload | null> {
  if (envelope.format !== 'zkProof' || !envelope.encryptedPayload) return null;
  try {
    const { decryptJson } = await loadEncryptionManager();
    return await decryptJson<QRSharingPayload>(envelope.encryptedPayload);
  } catch {
    return null;
  }
}
