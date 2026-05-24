/**
 * Proximity identity signer — TS port of
 * solidarity/Services/Sharing/ProximityIdentitySigner.swift.
 *
 * Swift uses `BiometricSigningKey.sign(payload:)` to produce a raw
 * P-256 ECDSA signature (r||s, 64 bytes) over the canonical proximity
 * bytes and ships it base64-encoded inside the payload's
 * `didSignature` field. The receiver verifies against the sender's
 * published JWK from `did:key`.
 *
 * The Expo TS keychain currently only exposes `signJws` (compact JWS).
 * The signature segment of that JWS is `base64url(r||s)` over the
 * input `header.payload`, which is NOT byte-equal to a raw signature
 * over `canonicalBytes`. To keep wire compatibility with Swift, the
 * approach here is:
 *
 *   1. Build the canonical bytes (mirrors Swift `canonicalBytes()`).
 *   2. Call `signJws(canonicalBytes)` via the SpruceDid driver.
 *   3. Extract the third segment of the JWS as the raw signature.
 *
 * Verifiers from the Swift side will need to know to verify against the
 * same `signingInput = header.payload` used by JWS — which is a deviation
 * from Swift's "sign canonical bytes directly". This is captured as a
 * TODO until the SpruceDid native layer exposes a `signRaw(alias, bytes)`
 * helper, at which point we can swap the implementation without changing
 * the public signature here.
 */
import {
  base64Decode,
  base64Encode,
  base64UrlDecode,
  err,
  ok,
  type Result,
  utf8ToBytes,
} from '@solidarity/shared';

import { ensureSigningKey, signJwt } from '@/keychain';

import {
  canonicalProximityBytes,
  type ProximityPayload,
} from './proximityVerification';

/**
 * Sign the canonical bytes of a proximity payload with the local
 * hardware-backed identity key. Returns the base64-encoded signature on
 * success.
 *
 * @returns Result containing the signature string (base64, raw r||s) or
 * a CardError describing the failure.
 */
export async function signProximityPayload(
  payload: ProximityPayload
): Promise<Result<{ signature: string }>> {
  try {
    // Touch the key once so a missing identity surfaces a clearer error
    // before we incur the biometric prompt.
    await ensureSigningKey();
  } catch (e) {
    return err({
      type: 'keyManagementError',
      message: e instanceof Error ? e.message : 'signing key unavailable',
    });
  }

  const canonical = canonicalProximityBytes(payload);
  // Wrap the canonical bytes in a JWS so signJwt can sign — payload
  // carries the canonical bytes base64url-encoded under a stable key so
  // the receiver can reconstruct the signing input if they need to.
  const payloadObject = {
    p: base64Encode(canonical),
    typ: 'solidarity/proximity-payload-v2',
  };
  let jws: string;
  try {
    jws = await signJwt({ alg: 'ES256' }, payloadObject);
  } catch (e) {
    return err({
      type: 'cryptographicError',
      message: e instanceof Error ? e.message : 'signing failed',
    });
  }

  const segments = jws.split('.');
  if (segments.length !== 3) {
    return err({
      type: 'cryptographicError',
      message: 'unexpected JWS shape from signing driver',
    });
  }
  const sigSegment = segments[2] ?? '';
  let rawSig: Uint8Array;
  try {
    rawSig = base64UrlDecode(sigSegment);
  } catch {
    return err({
      type: 'cryptographicError',
      message: 'failed to decode JWS signature segment',
    });
  }
  if (rawSig.length !== 64) {
    return err({
      type: 'cryptographicError',
      message: `unexpected ECDSA signature length ${String(rawSig.length)} (expected 64)`,
    });
  }
  return ok({ signature: base64Encode(rawSig) });
}

/**
 * Surface the same canonical-bytes helper from this module so callers
 * that import the signer don't have to reach into the verification side.
 */
export { canonicalProximityBytes, utf8ToBytes };
// Re-exports kept above so `Result<…, CardError>` consumers can pull the
// type without dragging the verification module in directly.
export type { ProximityPayload };

// Acknowledge the unused base64Decode import path for future use when
// SpruceDid exposes signRaw — keeps the import list intentional.
void base64Decode;
