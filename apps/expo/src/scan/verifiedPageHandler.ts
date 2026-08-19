/**
 * Verified Page payload router — 1.3.3 Task A2.3 (US-11): recognises a
 * scanned/deep-linked Verified Page fragment (`https://solidarity.gg/#<frag>`,
 * a bare `#<frag>` fragment, or the bare `<frag>` blob itself) and runs the
 * FULL local verification pipeline described in 01-spec §4.3/§8:
 *
 *   decodeFragment(frag) -> JWS string
 *     -> read payload.did UNVERIFIED (just to know which key to check against)
 *     -> verifyCompact(jws, thatDid)   (did:key IS the public key, so a
 *                                       valid signature under the embedded
 *                                       did proves control of that identity)
 *     -> parseProfile(verified payload)
 *
 * Every step is local — no network call, works in airplane mode (S-level
 * verification per 01-spec §6/§8).
 *
 * `parseVerifiedPagePayload` returns `null` when `payload` isn't recognised
 * as a Verified Page form at all (OIDC URLs, `solidarity://` deep links,
 * the OLD exchange-QR wire formats `src/cards/qrEnvelope.ts` owns — bare
 * JWT `eyJ...`, `sce1:` compressed envelope, plain `{...}` JSON envelope) —
 * callers fall through to the existing handler chain unmodified. This
 * module never touches `src/scan/envelopeHandler.ts`; it's a new, separate
 * branch tried at the call site (`app/scan/index.tsx`, `src/deeplink/router.ts`)
 * BEFORE the old handler, and its own `decodeFragment`/`verifyCompact` calls
 * fail closed on anything that merely looks like a fragment but isn't.
 *
 * A recognised-but-invalid payload (bad signature, corrupt fragment, schema
 * mismatch) is NOT "not mine" — it's `{ kind: 'invalid', ... }` so the UI can
 * render an honest 「無法驗證」 error card (CLAUDE.md rule 8: never a partial
 * render of unverified data, and never silently fall through to a DIFFERENT
 * handler that might misinterpret the same bytes).
 */
import {
  DEFAULT_HANDLE_RESOLVERS,
  decodeFragment,
  decodeJwtUnsafe,
  matchHandleResolver,
  parseProfile,
  verifyCompact,
  type BadgeState,
  type HandleScheme,
  type ProfileRecord,
} from '@solidarity/shared';

import { isProductHost } from '../deeplink/domainVerification';

export type VerifiedPageErrorReason =
  | 'decodeFailed'
  | 'malformedPayload'
  | 'verificationFailed'
  | 'schemaInvalid'
  // ── `#nostr:<npub>` short-pointer resolution failures (resolveProfile.ts) ──
  /** No relay we asked could be reached before timeout — we're blind, retry. */
  | 'unreachable'
  /** A relay authoritatively confirmed the npub has no published profile. */
  | 'notFound'
  /** Profile JWS verified, but its `alsoKnownAs` doesn't claim this npub back
   *  — the reverse binding is missing, so a relay may have substituted a
   *  different (validly-signed) profile for the npub the sharer pointed at. */
  | 'bindingMismatch'
  /** A handle resolved, but advertised no usable profile retrieval source. */
  | 'profileSourceMissing'
  /** The handle's authoritative record exists but is malformed/conflicting. */
  | 'handleResolutionFailed'
  /** A remote boundary attempted to downgrade an HTTPS-only read. */
  | 'insecureEndpoint';

export interface VerifiedHandleBinding {
  readonly scheme: HandleScheme;
  readonly handle: string;
  readonly state: BadgeState;
  readonly rebindGeneration?: number;
  readonly reboundAt?: number | null;
}

export type VerifiedPageResult =
  | {
      readonly kind: 'verified';
      readonly record: ProfileRecord;
      readonly jws: string;
      readonly handleBinding?: VerifiedHandleBinding;
    }
  | { readonly kind: 'invalid'; readonly reason: VerifiedPageErrorReason; readonly detail: string };

/**
 * Prefixes owned outright by an existing, older payload format — never
 * treated as a bare verified-page fragment blob even though they may
 * happen to pass the base64url-charset check below. `eyJ` (bare JWT
 * header) and `{` (plaintext/zkProof JSON envelope) are the two forms
 * `src/cards/qrEnvelope.ts`'s `parseEnvelopeFromWire` recognises without a
 * URL scheme wrapper, so they're the only ones that could otherwise
 * collide with the "bare fragment" heuristic. `sce1:` is listed too for
 * defense-in-depth even though its `:` already fails the base64url check.
 */
const OLD_FORMAT_PREFIXES: readonly string[] = ['eyJ', '{', 'sce1:'];

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/u;

function looksLikeBareFragment(candidate: string): boolean {
  if (candidate.length === 0) return false;
  if (OLD_FORMAT_PREFIXES.some((prefix) => candidate.startsWith(prefix))) return false;
  return BASE64URL_RE.test(candidate);
}

/**
 * Pull the fragment blob out of `payload`, or `null` if this doesn't look
 * like a Verified Page payload at all. Recognises, in order:
 *   1. `http(s)://<host>/...#<frag>` — the QR/link form `ProfileSummaryCard`
 *      encodes (any host; deep-link-level domain trust is a separate
 *      concern from "can this be decoded", enforced by
 *      `src/deeplink/domainVerification.ts` for the deep-link path).
 *   2. any other URL scheme (`openid4vp:`, `solidarity:`, ...) -> not mine.
 *   3. a bare `#<frag>` fragment (no URL wrapper).
 *   4. a bare `<frag>` blob, guarded against the old wire formats above.
 */
function extractFragmentCandidate(payload: string): string | null {
  const trimmed = payload.trim();
  if (trimmed.length === 0) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hash.length > 1 ? url.hash.slice(1) : null;
  } catch {
    // Not a URL at all — fall through to the bare-fragment forms below.
  }

  if (trimmed.startsWith('#')) return trimmed.slice(1);
  return looksLikeBareFragment(trimmed) ? trimmed : null;
}

/** Read `payload.did` from a compact JWS WITHOUT verifying the signature yet. */
function readUnverifiedDid(jws: string): string | null {
  try {
    const { payload } = decodeJwtUnsafe<{ readonly did?: unknown }>(jws);
    return typeof payload.did === 'string' && payload.did.length > 0 ? payload.did : null;
  } catch {
    return null;
  }
}

/**
 * Verify an already-extracted fragment blob (e.g. `url.hash.slice(1)` from
 * a deep link) — the core pipeline, exported separately so callers that
 * already have the fragment (not a full payload string) can skip
 * `extractFragmentCandidate`.
 */
/**
 * Verify a profile JWS directly — the shared tail of the pipeline, used by
 * BOTH the offline fragment path (`verifyFragment`, after decompressing the
 * blob) and the `#nostr:<npub>` pointer path (`resolveProfile.ts`, where the
 * relay's kind-30078 `content` IS the JWS, no fragment decode). Verifying
 * the embedded did:key signature is what makes the relay untrusted — it can
 * deliver the bytes, it can't forge a signature under the did.
 */
export function verifyProfileJws(jws: string): VerifiedPageResult {
  const did = readUnverifiedDid(jws);
  if (did === null) {
    return { kind: 'invalid', reason: 'malformedPayload', detail: 'payload is missing a did field' };
  }

  const verified = verifyCompact(jws, did);
  if (!verified.ok) return { kind: 'invalid', reason: 'verificationFailed', detail: verified.error };

  const parsed = parseProfile(verified.value);
  if (!parsed.ok) return { kind: 'invalid', reason: 'schemaInvalid', detail: parsed.error };

  return { kind: 'verified', record: parsed.value, jws };
}

export function verifyFragment(fragment: string): VerifiedPageResult {
  const decoded = decodeFragment(fragment);
  if (!decoded.ok) return { kind: 'invalid', reason: 'decodeFailed', detail: decoded.error };
  return verifyProfileJws(decoded.value);
}

/**
 * Entry point for a raw scanned QR string. Returns `null` when `payload`
 * isn't a Verified Page form at all (let the caller fall through to the
 * existing handler chain); otherwise runs the full verify pipeline and
 * always returns a `VerifiedPageResult` (verified or a structured invalid
 * reason — never `null` once we've decided this payload IS ours).
 */
export function parseVerifiedPagePayload(payload: string): VerifiedPageResult | null {
  if (typeof payload !== 'string') return null;
  const fragment = extractFragmentCandidate(payload);
  if (fragment === null) return null;
  return verifyFragment(fragment);
}

/**
 * The three Verified Page share/read forms a scanned QR / typed string can carry:
 *   - `fragment` — the self-contained offline blob (deflate+base64url of the
 *     profile JWS), verifiable locally in airplane mode;
 *   - `pointer` — the short `#nostr:<npub>` locator, which needs an async
 *     relay round-trip (`resolveProfile.ts`) to fetch + verify.
 *   - `handle` — a supported Solidarity/ATProto/DNS/ENS handle, resolved through the
 *     shared deterministic resolver registry before profile retrieval.
 * The scanner (`app/scan/index.tsx`) branches on this to pick the sync-local
 * vs. async-network path. `null` = not a Verified Page payload at all.
 */
export type VerifiedPagePayload =
  | { readonly kind: 'fragment'; readonly fragment: string }
  | { readonly kind: 'pointer'; readonly npub: string }
  | { readonly kind: 'handle'; readonly handle: string };

/** `npub1` + bech32 data. `resolveProfile.ts`'s `npubDecode` does the real
 *  checksum/length validation; this is just the cheap shape gate + a DoS
 *  length cap on unauthenticated scanned/deep-link input (an npub is ~63
 *  chars; 90 is generous headroom). */
const NPUB_RE = /^npub1[023456789acdefghjklmnpqrstuvwxyz]+$/u;
const MAX_NPUB_LENGTH = 90;

/**
 * Pull the inner hash/blob out of a URL / bare-`#` / bare string. Kept
 * SEPARATE from `extractFragmentCandidate` above (rather than refactoring
 * that tested extractor) so the existing fragment-only path is untouched —
 * this one must surface a `nostr:` prefix that `looksLikeBareFragment`
 * (base64url-only) would otherwise reject.
 */
function extractInner(payload: string): string | null {
  const trimmed = payload.trim();
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.hash.length > 1 ? url.hash.slice(1) : null;
  } catch {
    return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  }
}

function isSupportedHandle(handle: string): boolean {
  return matchHandleResolver(handle, DEFAULT_HANDLE_RESOLVERS) !== undefined;
}

function extractHandleCandidate(payload: string): string | null {
  const trimmed = payload.trim();
  if (trimmed.length === 0) return null;
  if (isSupportedHandle(trimmed)) return trimmed;

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== 'https:' ||
      !isProductHost(url.host) ||
      url.hash.length > 0
    ) {
      return null;
    }
    const segments = url.pathname.replace(/^\//u, '').split('/');
    if (segments.length !== 1 || !segments[0]?.startsWith('@')) return null;
    let handle: string;
    try {
      handle = decodeURIComponent(segments[0].slice(1));
    } catch {
      return null;
    }
    return isSupportedHandle(handle) ? handle : null;
  } catch {
    return isSupportedHandle(trimmed) ? trimmed : null;
  }
}

export function classifyVerifiedPagePayload(payload: string): VerifiedPagePayload | null {
  if (typeof payload !== 'string') return null;
  const handle = extractHandleCandidate(payload);
  if (handle !== null) return { kind: 'handle', handle };
  const inner = extractInner(payload);
  if (inner === null || inner.length === 0) return null;

  // Pointer form `nostr:npub1…` — checked BEFORE the fragment heuristic
  // (the `nostr:` prefix's `:` fails the base64url charset check anyway).
  if (inner.startsWith('nostr:')) {
    const npub = inner.slice('nostr:'.length);
    return NPUB_RE.test(npub) && npub.length <= MAX_NPUB_LENGTH ? { kind: 'pointer', npub } : null;
  }

  return looksLikeBareFragment(inner) ? { kind: 'fragment', fragment: inner } : null;
}
