/**
 * Scan-side entry for `passport_show_v1` presentations. Detects whether a
 * reassembled QR payload is a show-presentation envelope (raw JSON or
 * `sce1:` compressed), resolves the freshness expectation (outstanding
 * verifier challenge vs time-bucket window), and runs the full
 * verification. Dependencies (native verifyNoirProof, vk pins, challenge
 * store, clock) are injectable so the routing logic unit-tests without the
 * Nitro bridge.
 */
import { decompressQR } from '@/cards/qrCompression';
import { loadPassportNitroModules } from '@/passport/nitroModules';
import {
  PASSPORT_SHOW_LINK_SCOPE,
  PASSPORT_SHOW_PRESENTATION_SCHEMA,
  parseJsonRecord,
  parsePassportShowEnvelopeJson,
} from '@/passport/showPresentation';
import {
  consumePassportShowChallenge,
  verifyPassportShowPresentation,
  type VerifyPassportShowPresentationResult,
} from '@/passport/showVerifier';
import type * as ShowWitnessVault from '@/passport/showWitnessVault';

export { PASSPORT_SHOW_LINK_SCOPE } from '@/passport/showPresentation';

export type PassportShowScanResult =
  | VerifyPassportShowPresentationResult
  | { readonly ok: false; readonly reason: 'zk-unavailable' };

export interface PassportShowScanDeps {
  readonly verifyNoirProof:
    | ((proof: ArrayBuffer, vk: ArrayBuffer) => Promise<boolean>)
    | null;
  readonly vkPins: {
    readonly buildPin: string | null;
    readonly selfPin: string | null;
  };
  readonly consumeChallenge: (now: Date) => Uint8Array | null;
  readonly now: Date;
}

function defaultDeps(): PassportShowScanDeps {
  const zk = loadPassportNitroModules().zk;
  // Lazy require — the vault pulls in MMKV (→ react-native), which must not
  // load in unit tests or before a show presentation is actually scanned.
  const vault = require('@/passport/showWitnessVault') as typeof ShowWitnessVault;
  return {
    verifyNoirProof:
      zk === null ? null : (proof, vk) => zk.verifyNoirProof(proof, vk),
    vkPins: vault.resolvePassportShowVkPins(),
    consumeChallenge: (now) => consumePassportShowChallenge(now),
    now: new Date(),
  };
}

/**
 * Returns the envelope JSON when the payload is a show presentation
 * (decompressing `sce1:` wrapping if needed), or null for anything else so
 * the caller falls through to the existing envelope routing.
 */
export function extractPassportShowEnvelopeJson(payload: string): string | null {
  let candidate = payload;
  if (payload.startsWith('sce1:')) {
    const decompressed = decompressQR(payload);
    if (!decompressed) return null;
    candidate = new TextDecoder().decode(decompressed);
  }
  const record = parseJsonRecord(candidate);
  return record?.['schema'] === PASSPORT_SHOW_PRESENTATION_SCHEMA ? candidate : null;
}

/**
 * Verify a scanned payload as a show presentation. Returns null when the
 * payload is not one (caller falls through); otherwise the verify result.
 */
export async function handlePassportShowScan(
  payload: string,
  injectedDeps?: PassportShowScanDeps
): Promise<PassportShowScanResult | null> {
  const envelopeJson = extractPassportShowEnvelopeJson(payload);
  if (envelopeJson === null) return null;
  const envelope = parsePassportShowEnvelopeJson(envelopeJson);
  if (envelope === null) return { ok: false, reason: 'malformed-envelope' };

  // Resolve deps only once the payload IS a show presentation — every other
  // scanned QR must not pay the Nitro module load.
  const deps = injectedDeps ?? defaultDeps();
  if (deps.verifyNoirProof === null) {
    return { ok: false, reason: 'zk-unavailable' };
  }

  // Use the structurally parsed envelope to choose the freshness expectation;
  // verification still cross-checks all display data against proof bytes.
  if (envelope.freshness === 'challenge') {
    const expectedNonceHash = deps.consumeChallenge(deps.now);
    if (expectedNonceHash === null) {
      // No outstanding (unexpired) challenge from this verifier — the
      // presentation cannot be bound to anything we issued.
      return { ok: false, reason: 'nonce-mismatch' };
    }
    return verifyPassportShowPresentation({
      envelopeJson,
      verifyNoirProof: deps.verifyNoirProof,
      vkPins: deps.vkPins,
      expectedScope: PASSPORT_SHOW_LINK_SCOPE,
      freshness: { mode: 'challenge', expectedNonceHash },
      now: deps.now,
    });
  }

  return verifyPassportShowPresentation({
    envelopeJson,
    verifyNoirProof: deps.verifyNoirProof,
    vkPins: deps.vkPins,
    expectedScope: PASSPORT_SHOW_LINK_SCOPE,
    freshness: {
      mode: 'time-bucket',
      scope: PASSPORT_SHOW_LINK_SCOPE,
      now: deps.now,
    },
    now: deps.now,
  });
}
