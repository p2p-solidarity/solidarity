/**
 * Proximity verification — TS port of
 * solidarity/Services/Sharing/ProximityVerificationHelper.swift
 *   + ProximityIdentitySigner.verify (signature half).
 *
 * Two halves, kept here for the verifier side of the proximity exchange:
 *   1. `verifyProximityPayload` — checks the DID-bound signature on a
 *      received `ProximityPayload` against the supplied sender JWK. Raw
 *      r||s (64 bytes) is the canonical wire format Swift produces; we
 *      additionally accept DER for cross-platform interop, matching the
 *      Swift `ProximityIdentitySigner.verify` fallback.
 *   2. `canonicalProximityBytes` — deterministic byte serialisation the
 *      sender signs and the receiver verifies. Keep field order verbatim
 *      with Swift's `ProximitySharingPayload.canonicalBytes()` so a
 *      payload minted on iOS verifies on Android and vice versa.
 *
 * The Semaphore-side `pending`/`verified` state still lives on the
 * native bridge (see `@/zk/groupManager.verifyGroupProof`); this module
 * only handles the DID-bound exchange-signature half.
 */
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';

import {
  base64Decode,
  jwkToPublicKey,
  utf8ToBytes,
  err,
  ok,
  type PublicKeyJWK,
  type Result,
} from '@solidarity/shared';

/**
 * Minimal proximity-payload shape — mirrors the Swift
 * `ProximitySharingPayload` fields that participate in the canonical
 * signing bytes (everything else is metadata the signer can ignore).
 */
export interface ProximityPayload {
  readonly senderID: string;
  readonly senderDID?: string;
  readonly receiverPeerName?: string;
  readonly nonce?: string;
  readonly timestamp: Date | string;
  readonly shareId?: string;
  readonly scope?: string;
  /** Base64-encoded ECDSA signature (raw r||s, optionally DER). */
  readonly didSignature?: string;
}

/**
 * Build the canonical byte sequence the sender signs / the receiver
 * verifies. Mirrors the Swift `canonicalBytes()` helper on
 * `ProximitySharingPayload`: pipe-joined UTF-8, ISO8601-with-fractional-
 * seconds timestamp, empty string for missing optionals. The byte
 * representation MUST stay verbatim across Swift / TS or signatures
 * minted on one platform won't verify on the other.
 */
export function canonicalProximityBytes(payload: ProximityPayload): Uint8Array {
  const ts =
    payload.timestamp instanceof Date
      ? payload.timestamp.toISOString()
      : payload.timestamp;
  const parts: readonly string[] = [
    payload.senderID,
    payload.senderDID ?? '',
    payload.receiverPeerName ?? '',
    payload.nonce ?? '',
    ts,
    payload.shareId ?? '',
    payload.scope ?? '',
  ];
  return utf8ToBytes(parts.join('|'));
}

function tryVerify(sig: Uint8Array, message: Uint8Array, jwk: PublicKeyJWK): boolean {
  const digest = sha256(message);
  const pub = jwkToPublicKey(jwk);
  // Raw r||s — what `ProximityIdentitySigner.signBase64` emits on Swift.
  if (sig.length === 64) {
    try {
      if (p256.verify(sig, digest, pub)) return true;
    } catch {
      // Fall through to DER attempt.
    }
  }
  // DER — accepted for cross-platform interop (Swift's verify also tries it).
  try {
    return p256.verify(sig, digest, pub, { format: 'der' });
  } catch {
    return false;
  }
}

/**
 * Verify the DID-bound signature on a proximity payload. Returns ok(void)
 * on success and a CardError on failure so the caller can surface a
 * specific toast (signature mismatch vs malformed signature vs missing
 * fields).
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function verifyProximityPayload(
  payload: ProximityPayload,
  senderJwk: PublicKeyJWK
): Promise<Result<void>> {
  if (!payload.didSignature) {
    return err({
      type: 'validationError',
      message: 'proximity payload is missing didSignature',
    });
  }

  let sig: Uint8Array;
  try {
    sig = base64Decode(payload.didSignature);
  } catch {
    return err({
      type: 'cryptographicError',
      message: 'didSignature is not valid base64',
    });
  }

  const message = canonicalProximityBytes(payload);
  if (!tryVerify(sig, message, senderJwk)) {
    return err({
      type: 'proofVerificationError',
      message: 'proximity signature verification failed',
    });
  }
  return ok(undefined);
}
