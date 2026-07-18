/**
 * webSign — the App↔Web per-action remote-signing envelopes (research
 * notes-1.3.3 §4, grill decisions G3/G4). The web draft-store never holds
 * the root mnemonic; when the user wants to sign a Profile Record from the
 * browser, the web page signs a *request* with an ephemeral P-256 "session"
 * did:key and hands it to the app (QR / deep-link — transport is a later
 * task). The app verifies the request, shows the user a per-field diff,
 * gates on Face ID, signs the final canonical `ProfileRecord` with the ROOT
 * did, and returns a *response* envelope (also root-signed) that binds back
 * to the exact request.
 *
 * SECURITY MODEL — read before touching a verify path:
 *   - The web session signature proves *payload integrity + session
 *     proof-of-possession*, NOT website origin. A phishing page can claim
 *     the same `originHint` and mint its own session did. `originHint` is
 *     therefore an untrusted hint, never an authorization input — the app's
 *     human-reviewed field diff is the real security boundary. These
 *     primitives fail closed on shape/replay/substitution; they do not (and
 *     cannot) attest that the request came from a legitimate site.
 *   - The response is bound to its request three ways: `requestId`/`nonce`
 *     equality, `requestDigest === sha256(exact signed-request bytes)`, and
 *     `webSessionDid` equality. The embedded `profileJws` must verify under
 *     the pinned ROOT did AND its record must be canonically identical to
 *     the draft the request carried — an app that signs a *different* record
 *     than the one the user reviewed is rejected as substitution.
 *   - Replay defense is layered: verify enforces a bounded lifetime
 *     (`exp - iat <= maxAgeSeconds`, `now ∈ [iat - skew, exp]`) and echoes
 *     the request's `requestId`/`nonce` so a stale response can't be pasted
 *     against a different in-flight request. Single-use ("consumed-once")
 *     enforcement — retiring a `requestId` after first accept, invalidating
 *     the session — is the CALLER's responsibility; these pure primitives
 *     hold no state. See `verifyWebSignResponse`'s doc.
 *
 * Signing routes through `signCompact`/`verifyCompact` (jws.ts) — the one
 * did:key ES256 primitive — and payloads canonicalize via `stableJSON`
 * (canonical.ts) so an identical logical object always hashes/signs to the
 * same bytes. Every `verify*` returns a `Result` with a closed, tagged
 * error union and never throws across the boundary.
 */
import { z } from 'zod';

import { stableJSON } from './canonical';
import { base64UrlDecode, base64UrlEncode, bytesToUtf8, utf8ToBytes } from './crypto/base64';
import { sha256Bytes } from './crypto/hash';
import { signCompact, verifyCompact, type Signer } from './jws';
import { parseProfile, type ProfileRecord } from './profile';
import { err, ok, type Result } from './types/result';

export const WEB_SIGN_VERSION = 1;
export const WEB_SIGN_REQUEST_TYP = 'solidarity.webSignRequest.v1';
export const WEB_SIGN_RESPONSE_TYP = 'solidarity.webSignResponse.v1';

/**
 * Compiled action allowlist. v1 only supports `profile.sign`; the verifier
 * rejects any action not in this set (a future action must be added here
 * *and* given its own verification policy — never accepted implicitly).
 */
export type WebSignAction = 'profile.sign';
const WEB_SIGN_ACTIONS: ReadonlySet<string> = new Set<WebSignAction>(['profile.sign']);

/** Max canonical size of a `draft`, in UTF-8 bytes — DoS guard on the JWS payload. */
export const WEB_SIGN_DRAFT_MAX_BYTES = 64 * 1024;
/** Max `originHint` length (chars) — untrusted hint, capped so it can't bloat the envelope. */
const ORIGIN_HINT_MAX_CHARS = 2_048;
/** Hard ceiling on `exp - iat` (seconds). Research §4: signing requests live ≤5min. */
export const WEB_SIGN_MAX_AGE_SECONDS = 300;
/** Clock-skew tolerance (seconds) on the lower bound — mirrors challenge.ts. */
export const WEB_SIGN_MAX_SKEW_SECONDS = 120;
/** Minimum entropy: requestId ≥ 256-bit, nonce ≥ 128-bit (decoded bytes). */
const REQUEST_ID_MIN_BYTES = 32;
const NONCE_MIN_BYTES = 16;

export interface WebSignRequestV1 {
  readonly v: 1;
  readonly typ: 'solidarity.webSignRequest.v1';
  /** base64url, ≥256-bit — the per-action id echoed by the response. */
  readonly requestId: string;
  /** base64url, ≥128-bit — anti-replay nonce echoed by the response. */
  readonly nonce: string;
  /** Untrusted origin hint (see module security model). NOT an authorization input. */
  readonly originHint: string;
  /** Ephemeral P-256 session did:key that signed this request (proof-of-possession only). */
  readonly webSessionDid: string;
  readonly action: WebSignAction;
  /** The Profile Record draft the user is asked to sign — validated via `parseProfile`. */
  readonly draft: ProfileRecord;
  /** base64url(sha256(stableJSON(draft))) — recomputed and re-checked on verify. */
  readonly draftDigest: string;
  /** Unix seconds — issued-at. */
  readonly iat: number;
  /** Unix seconds — hard expiry. */
  readonly exp: number;
}

export interface WebSignResponseV1 {
  readonly v: 1;
  readonly typ: 'solidarity.webSignResponse.v1';
  /** Echoes the request's `requestId`. */
  readonly requestId: string;
  /** Echoes the request's `nonce`. */
  readonly nonce: string;
  /** base64url(sha256(exact signed-request compact-JWS bytes)) — binds to the precise request. */
  readonly requestDigest: string;
  /** Echoes the request's `webSessionDid`. */
  readonly webSessionDid: string;
  /** Root-signed compact JWS of the final `ProfileRecord` (must equal the request draft). */
  readonly profileJws: string;
  /** Unix seconds — issued-at. */
  readonly iat: number;
  /** Unix seconds — hard expiry. */
  readonly exp: number;
}

export type WebSignRequestError =
  | { readonly kind: 'malformedEnvelope'; readonly detail: string }
  | { readonly kind: 'signatureInvalid'; readonly detail: string }
  | { readonly kind: 'schemaInvalid'; readonly detail: string }
  | { readonly kind: 'unknownAction'; readonly detail: string }
  | { readonly kind: 'draftTooLarge'; readonly detail: string }
  | { readonly kind: 'digestMismatch'; readonly detail: string }
  | { readonly kind: 'draftInvalid'; readonly detail: string }
  | { readonly kind: 'expiryInvalid'; readonly detail: string };

export type WebSignResponseError =
  | { readonly kind: 'malformedEnvelope'; readonly detail: string }
  | { readonly kind: 'signatureInvalid'; readonly detail: string }
  | { readonly kind: 'schemaInvalid'; readonly detail: string }
  | { readonly kind: 'expiryInvalid'; readonly detail: string }
  | { readonly kind: 'requestMismatch'; readonly detail: string }
  | { readonly kind: 'profileSignatureInvalid'; readonly detail: string }
  | { readonly kind: 'profileInvalid'; readonly detail: string }
  | { readonly kind: 'recordMismatch'; readonly detail: string };

// ---------------------------------------------------------------------------
// Digest helpers
// ---------------------------------------------------------------------------

/** base64url(sha256(utf8(input))) — the wire encoding for every digest here. */
function sha256B64Url(input: string): string {
  return base64UrlEncode(sha256Bytes(input));
}

/** Canonical draft digest: base64url(sha256(stableJSON(draft))). */
export function webSignDraftDigest(draft: unknown): string {
  return sha256B64Url(stableJSON(draft));
}

/** Request digest: base64url(sha256(exact signed-request compact-JWS string)). */
export function webSignRequestDigest(requestJws: string): string {
  return sha256B64Url(requestJws);
}

// ---------------------------------------------------------------------------
// Envelope zod schemas (closed / strict). `draft` is validated only as a
// JSON object here; `parseProfile` does the deep Profile Record check so a
// malformed draft is reported as `draftInvalid`, not a generic schema error.
// ---------------------------------------------------------------------------

const B64URL_RE = /^[A-Za-z0-9_-]+$/u;

function decodedByteLength(value: string): number {
  try {
    return base64UrlDecode(value).length;
  } catch {
    return -1;
  }
}

const b64urlWithMinBytes = (minBytes: number) =>
  z.string().refine((s) => B64URL_RE.test(s) && decodedByteLength(s) >= minBytes, {
    message: `must be base64url encoding at least ${String(minBytes)} bytes`,
  });

const unixSeconds = z.number().int().nonnegative();

const webSignRequestEnvelopeSchema = z
  .object({
    v: z.literal(WEB_SIGN_VERSION),
    typ: z.literal(WEB_SIGN_REQUEST_TYP),
    requestId: b64urlWithMinBytes(REQUEST_ID_MIN_BYTES),
    nonce: b64urlWithMinBytes(NONCE_MIN_BYTES),
    originHint: z.string().max(ORIGIN_HINT_MAX_CHARS),
    webSessionDid: z.string().min(1),
    action: z.string(),
    draft: z.record(z.string(), z.unknown()),
    draftDigest: z.string().min(1),
    iat: unixSeconds,
    exp: unixSeconds,
  })
  .strict();

const webSignResponseEnvelopeSchema = z
  .object({
    v: z.literal(WEB_SIGN_VERSION),
    typ: z.literal(WEB_SIGN_RESPONSE_TYP),
    requestId: b64urlWithMinBytes(REQUEST_ID_MIN_BYTES),
    nonce: b64urlWithMinBytes(NONCE_MIN_BYTES),
    requestDigest: z.string().min(1),
    webSessionDid: z.string().min(1),
    profileJws: z.string().min(1),
    iat: unixSeconds,
    exp: unixSeconds,
  })
  .strict();

// ---------------------------------------------------------------------------
// Builders / signers (pure; may throw only on caller programming error, the
// same contract as `signCompact`). The verify boundary never throws.
// ---------------------------------------------------------------------------

export interface BuildWebSignRequestParams {
  readonly requestId: string;
  readonly nonce: string;
  readonly originHint: string;
  readonly webSessionDid: string;
  readonly draft: ProfileRecord;
  readonly iat: number;
  readonly exp: number;
  /** Defaults to the only v1 action, `profile.sign`. */
  readonly action?: WebSignAction;
}

/**
 * Assemble a `WebSignRequestV1`, stamping `v`/`typ` and computing
 * `draftDigest` from the draft so a caller can never desync the two. Pure —
 * does not sign.
 */
export function buildWebSignRequest(params: BuildWebSignRequestParams): WebSignRequestV1 {
  return {
    v: WEB_SIGN_VERSION,
    typ: WEB_SIGN_REQUEST_TYP,
    requestId: params.requestId,
    nonce: params.nonce,
    originHint: params.originHint,
    webSessionDid: params.webSessionDid,
    action: params.action ?? 'profile.sign',
    draft: params.draft,
    draftDigest: webSignDraftDigest(params.draft),
    iat: params.iat,
    exp: params.exp,
  };
}

/**
 * Sign a request as a compact JWS under the web session did. `webSessionDid`
 * MUST equal `req.webSessionDid` (the payload's self-asserted session key) —
 * signing under any other did produces a request that fails verification, so
 * a mismatch is a caller bug and throws (mirrors `signCompact`'s length check).
 */
export async function signWebSignRequest(
  req: WebSignRequestV1,
  webSessionDid: string,
  sign: Signer
): Promise<string> {
  if (webSessionDid !== req.webSessionDid) {
    throw new Error('signWebSignRequest: webSessionDid must equal req.webSessionDid');
  }
  return signCompact(req, webSessionDid, sign);
}

/**
 * Assemble a `WebSignResponseV1` bound to a verified outstanding request:
 * echoes its `requestId`/`nonce`/`webSessionDid`, computes `requestDigest`
 * over the exact signed-request bytes, and carries the root-signed final
 * record `profileJws`. Pure — does not sign the envelope.
 */
export function buildWebSignResponse(
  outstanding: OutstandingWebSignRequest,
  profileJws: string,
  iat: number,
  exp: number
): WebSignResponseV1 {
  return {
    v: WEB_SIGN_VERSION,
    typ: WEB_SIGN_RESPONSE_TYP,
    requestId: outstanding.request.requestId,
    nonce: outstanding.request.nonce,
    requestDigest: webSignRequestDigest(outstanding.jws),
    webSessionDid: outstanding.request.webSessionDid,
    profileJws,
    iat,
    exp,
  };
}

/** Sign a response envelope as a compact JWS under the ROOT did. */
export async function signWebSignResponse(
  res: WebSignResponseV1,
  rootDid: string,
  sign: Signer
): Promise<string> {
  return signCompact(res, rootDid, sign);
}

// ---------------------------------------------------------------------------
// Verify — request
// ---------------------------------------------------------------------------

export interface VerifyWebSignRequestOpts {
  /** Inject "now" (epoch **milliseconds**) for deterministic tests. Defaults to `Date.now()`. */
  readonly nowMs?: number;
  /** Max allowed `exp - iat` (seconds). Default `WEB_SIGN_MAX_AGE_SECONDS` (300). */
  readonly maxAgeSeconds?: number;
  /** Clock-skew tolerance (seconds) on the lower bound. Default `WEB_SIGN_MAX_SKEW_SECONDS` (120). */
  readonly maxSkewSeconds?: number;
}

/** Decode the payload segment of a compact JWS without verifying its signature. */
function decodeJwsPayload(jws: string): Result<Record<string, unknown>, string> {
  const parts = jws.split('.');
  if (parts.length !== 3) return err('expected 3 dot-separated parts');
  const [, payloadB64] = parts as [string, string, string];
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytesToUtf8(base64UrlDecode(payloadB64)));
  } catch {
    return err('payload is not valid base64url JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return err('payload is not a JSON object');
  }
  return ok(parsed as Record<string, unknown>);
}

function zodDetail(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
    .join('; ');
}

/**
 * Validate the `exp - iat <= maxAge` lifetime and that `now` falls inside
 * `[iat - skew, exp]`. Shared by request and response verification.
 */
function checkLifetime(
  iat: number,
  exp: number,
  opts: { readonly nowMs?: number; readonly maxAgeSeconds?: number; readonly maxSkewSeconds?: number }
): Result<void, string> {
  const maxAge = opts.maxAgeSeconds ?? WEB_SIGN_MAX_AGE_SECONDS;
  const skew = opts.maxSkewSeconds ?? WEB_SIGN_MAX_SKEW_SECONDS;
  const window = exp - iat;
  if (window <= 0) return err(`exp must be after iat (exp - iat = ${String(window)}s)`);
  if (window > maxAge) return err(`lifetime ${String(window)}s exceeds max ${String(maxAge)}s`);
  const nowSec = (opts.nowMs ?? Date.now()) / 1000;
  if (nowSec < iat - skew) return err(`not yet valid: now ${String(nowSec)} < iat-skew ${String(iat - skew)}`);
  if (nowSec > exp) return err(`expired: now ${String(nowSec)} > exp ${String(exp)}`);
  return ok(undefined);
}

/**
 * Verify a webSign request. In order: decode payload → extract the claimed
 * `webSessionDid` → `verifyCompact(jws, webSessionDid)` (this enforces the
 * ES256 header shape and `kid === webSessionDid#0`, i.e. session
 * proof-of-possession) → strict schema (unknown top-level field, wrong
 * `typ`/`v`, malformed id/nonce entropy all fail closed) → action in the
 * compiled allowlist → `draft` canonical size cap → `draftDigest` recomputed
 * and matched → `draft` parses as a `ProfileRecord` → bounded lifetime.
 * Never throws; returns a tagged `Result`. Does NOT prove request origin
 * (see module security model) — the app must still human-review the diff.
 */
export function verifyWebSignRequest(
  jws: string,
  opts: VerifyWebSignRequestOpts = {}
): Result<WebSignRequestV1, WebSignRequestError> {
  const decoded = decodeJwsPayload(jws);
  if (!decoded.ok) return err({ kind: 'malformedEnvelope', detail: decoded.error });

  const claimedDid = decoded.value['webSessionDid'];
  if (typeof claimedDid !== 'string' || claimedDid.length === 0) {
    return err({ kind: 'malformedEnvelope', detail: 'missing webSessionDid' });
  }

  const verified = verifyCompact(jws, claimedDid);
  if (!verified.ok) return err({ kind: 'signatureInvalid', detail: verified.error });

  const parsed = webSignRequestEnvelopeSchema.safeParse(verified.value);
  if (!parsed.success) return err({ kind: 'schemaInvalid', detail: zodDetail(parsed.error) });
  const envelope = parsed.data;

  if (!WEB_SIGN_ACTIONS.has(envelope.action)) {
    return err({ kind: 'unknownAction', detail: `action not allowed: ${envelope.action}` });
  }

  const canonicalDraft = stableJSON(envelope.draft);
  const draftBytes = utf8ToBytes(canonicalDraft).length;
  if (draftBytes > WEB_SIGN_DRAFT_MAX_BYTES) {
    return err({
      kind: 'draftTooLarge',
      detail: `draft ${String(draftBytes)}B exceeds ${String(WEB_SIGN_DRAFT_MAX_BYTES)}B`,
    });
  }

  const recomputed = sha256B64Url(canonicalDraft);
  if (recomputed !== envelope.draftDigest) {
    return err({ kind: 'digestMismatch', detail: 'draftDigest does not match sha256(canonical(draft))' });
  }

  const profile = parseProfile(envelope.draft);
  if (!profile.ok) return err({ kind: 'draftInvalid', detail: profile.error });

  const lifetime = checkLifetime(envelope.iat, envelope.exp, opts);
  if (!lifetime.ok) return err({ kind: 'expiryInvalid', detail: lifetime.error });

  return ok({
    v: WEB_SIGN_VERSION,
    typ: WEB_SIGN_REQUEST_TYP,
    requestId: envelope.requestId,
    nonce: envelope.nonce,
    originHint: envelope.originHint,
    webSessionDid: envelope.webSessionDid,
    action: envelope.action as WebSignAction,
    draft: profile.value,
    draftDigest: envelope.draftDigest,
    iat: envelope.iat,
    exp: envelope.exp,
  });
}

// ---------------------------------------------------------------------------
// Verify — response
// ---------------------------------------------------------------------------

/** A verified request plus the exact compact-JWS bytes that were signed. */
export interface OutstandingWebSignRequest {
  /** The exact signed-request compact JWS (used to recompute `requestDigest`). */
  readonly jws: string;
  /** The parsed, previously-verified request. */
  readonly request: WebSignRequestV1;
}

export interface VerifyWebSignResponseOpts {
  readonly nowMs?: number;
  readonly maxAgeSeconds?: number;
  readonly maxSkewSeconds?: number;
}

function checkResponseBinding(
  res: WebSignResponseV1,
  outstanding: OutstandingWebSignRequest
): Result<void, WebSignResponseError> {
  const { request } = outstanding;
  if (res.requestId !== request.requestId) {
    return err({ kind: 'requestMismatch', detail: 'requestId does not match outstanding request' });
  }
  if (res.nonce !== request.nonce) {
    return err({ kind: 'requestMismatch', detail: 'nonce does not match outstanding request' });
  }
  if (res.webSessionDid !== request.webSessionDid) {
    return err({ kind: 'requestMismatch', detail: 'webSessionDid does not match outstanding request' });
  }
  if (res.requestDigest !== webSignRequestDigest(outstanding.jws)) {
    return err({ kind: 'requestMismatch', detail: 'requestDigest does not match signed-request bytes' });
  }
  return ok(undefined);
}

/**
 * Verify a webSign response against the pinned ROOT did and the outstanding
 * request it must answer. In order: `verifyCompact(jws, expectedRootDid)`
 * (the response envelope is root-signed) → strict schema → bounded lifetime
 * → request binding (`requestId`/`nonce`/`webSessionDid` equality +
 * `requestDigest === sha256(exact signed-request bytes)`) → the embedded
 * `profileJws` verifies under `expectedRootDid` → its record parses as a
 * `ProfileRecord` → that record is *canonically identical* to the draft the
 * request carried (anti-substitution). Never throws; returns a tagged
 * `Result` with the verified final `ProfileRecord` on success.
 *
 * CONSUMED-ONCE is the caller's job: this primitive is stateless, so a
 * caller MUST retire the `requestId` (and invalidate the web session) after
 * the first successful verify to stop a captured response being replayed.
 */
export function verifyWebSignResponse(
  jws: string,
  expectedRootDid: string,
  outstanding: OutstandingWebSignRequest,
  opts: VerifyWebSignResponseOpts = {}
): Result<ProfileRecord, WebSignResponseError> {
  const verified = verifyCompact(jws, expectedRootDid);
  if (!verified.ok) return err({ kind: 'signatureInvalid', detail: verified.error });

  const parsed = webSignResponseEnvelopeSchema.safeParse(verified.value);
  if (!parsed.success) return err({ kind: 'schemaInvalid', detail: zodDetail(parsed.error) });
  const res: WebSignResponseV1 = { ...parsed.data };

  const lifetime = checkLifetime(res.iat, res.exp, opts);
  if (!lifetime.ok) return err({ kind: 'expiryInvalid', detail: lifetime.error });

  const binding = checkResponseBinding(res, outstanding);
  if (!binding.ok) return binding;

  const profileVerified = verifyCompact(res.profileJws, expectedRootDid);
  if (!profileVerified.ok) {
    return err({ kind: 'profileSignatureInvalid', detail: profileVerified.error });
  }

  const record = parseProfile(profileVerified.value);
  if (!record.ok) return err({ kind: 'profileInvalid', detail: record.error });

  if (stableJSON(record.value) !== stableJSON(outstanding.request.draft)) {
    return err({ kind: 'recordMismatch', detail: 'signed record differs from the request draft' });
  }

  return ok(record.value);
}
