/**
 * DID-challenge — the day-0 challenge/response format shared by the
 * Verify QR-scan flow and the Pear proximity channel (card exchange /
 * presentation), see docs/ref 04-plan Phase A1 amendment. A challenge is
 * plain data (not itself signed); `respondChallenge` signs the whole
 * object as a compact JWS via `signCompact` (jws.ts), and
 * `verifyChallengeResponse` checks three things in order: the JWS was
 * signed by `expected.subject` (the identity the challenge asks to
 * prove control of), the decoded payload matches `expected` field-for-
 * field (rejects nonce/purpose/requester tampering even under a
 * genuinely valid signature — because a subject could otherwise replay
 * a stale signed response against a different in-flight challenge), and
 * the challenge's `ts` is within a bounded clock-skew window of "now"
 * (rejects a captured signed response being replayed long after
 * issuance).
 */
import { base64UrlEncode } from './crypto/base64';
import { signCompact, verifyCompact, type Signer } from './jws';
import { err, ok, type Result } from './types/result';

export const CHALLENGE_VERSION = 1;
export const CHALLENGE_TYP = 'solidarity/challenge';

/** 32 random bytes, base64url-encoded — see `randomChallengeNonce`. */
const NONCE_BYTE_LENGTH = 32;

/** Default replay window: a signed response is valid for ±120s of `ts`. */
const DEFAULT_MAX_SKEW_SEC = 120;

export type ChallengePurpose = 'verify.scan' | 'pear.card' | 'pear.present';

export interface Challenge {
  readonly v: 1;
  readonly typ: 'solidarity/challenge';
  /** DID of the party asking for proof (scanner / Pear initiator). */
  readonly requester: string;
  /** DID being asked to prove control of its key — the expected signer. */
  readonly subject: string;
  readonly purpose: ChallengePurpose;
  /** 32 random bytes, base64url. */
  readonly nonce: string;
  /** Unix seconds. */
  readonly ts: number;
}

/**
 * Cryptographically-random challenge nonce (32 bytes, base64url).
 * Never `Math.random` — mirrors `crypto/uuid.ts`'s resolution of
 * `globalThis.crypto.getRandomValues`, which React Native gets from
 * `react-native-get-random-values` (imported at app entry) and
 * Bun/browsers provide natively.
 */
export function randomChallengeNonce(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'randomChallengeNonce: no crypto.getRandomValues — ensure react-native-get-random-values is imported at app entry'
    );
  }
  const bytes = new Uint8Array(NONCE_BYTE_LENGTH);
  c.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Stamps `v: 1, typ: 'solidarity/challenge'` onto a caller-assembled challenge. */
export function buildChallenge(p: Omit<Challenge, 'v' | 'typ'>): Challenge {
  return { v: CHALLENGE_VERSION, typ: CHALLENGE_TYP, ...p };
}

/** Sign `c` as a compact JWS under `did` — the subject's proof of control. */
export async function respondChallenge(c: Challenge, did: string, sign: Signer): Promise<string> {
  return signCompact(c, did, sign);
}

export interface VerifyChallengeResponseOpts {
  /** Max |now - ts| in seconds before a response is considered expired. Default 120. */
  readonly maxSkewSec?: number;
  /**
   * Inject "now" (epoch ms) for deterministic tests instead of mocking
   * `Date.now()`. Defaults to `Date.now()`.
   */
  readonly nowMs?: number;
}

/** The exact set of `Challenge` field names — used to reject a payload carrying extra keys. */
const CHALLENGE_FIELDS = ['v', 'typ', 'requester', 'subject', 'purpose', 'nonce', 'ts'] as const;

/**
 * Verify a challenge response: `verifyCompact(jws, expected.subject)`,
 * then strict field-by-field equality of the decoded payload against
 * `expected` (exact key set, not just a subset match — an attacker who
 * smuggles an extra field into an otherwise-matching payload must still
 * fail closed), then `|now - expected.ts| <= maxSkewSec`. Never throws;
 * every failure path returns `err(reason)`.
 */
export function verifyChallengeResponse(
  jws: string,
  expected: Challenge,
  opts?: VerifyChallengeResponseOpts
): Result<void, string> {
  const verified = verifyCompact(jws, expected.subject);
  if (!verified.ok) return verified;

  const payload = verified.value as Record<string, unknown>;
  const payloadKeys = Object.keys(payload).sort();
  const expectedKeys = [...CHALLENGE_FIELDS].sort();
  if (payloadKeys.length !== expectedKeys.length || payloadKeys.some((k, i) => k !== expectedKeys[i])) {
    return err(`challenge payload key set does not match Challenge shape (got ${JSON.stringify(payloadKeys)})`);
  }

  const fieldsMatch = CHALLENGE_FIELDS.every((key) => payload[key] === expected[key]);
  if (!fieldsMatch) {
    return err('challenge payload does not match the expected challenge');
  }

  const maxSkewSec = opts?.maxSkewSec ?? DEFAULT_MAX_SKEW_SEC;
  const nowSec = (opts?.nowMs ?? Date.now()) / 1000;
  const skewSec = Math.abs(nowSec - expected.ts);
  if (skewSec > maxSkewSec) {
    return err(`challenge expired: |now - ts| = ${String(skewSec)}s exceeds maxSkewSec=${String(maxSkewSec)}`);
  }

  return ok(undefined);
}
