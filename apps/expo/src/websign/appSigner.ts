/**
 * webSign — APP side of the App↔Web per-action remote-signing flow (research
 * notes-1.3.3 §4, grill decisions G3/G4). The shared primitives
 * (`@solidarity/shared`'s `webSign.ts`) own the wire envelopes + the
 * fail-closed verify boundary; this module is the seam the app screen drives:
 *
 *   reviewWebSignRequest(jws)  — verify the request, then compute a per-field
 *                                DIFF (draft vs the current local profile) for
 *                                the consent UI. Never throws.
 *   approveWebSignRequest(...) — root-sign the EXACT reviewed draft + the
 *                                bound response envelope, using the injected
 *                                Face-ID-gated root signer.
 *
 * SECURITY MODEL (read before touching a branch here):
 *   - The web session signature proves payload integrity + session
 *     proof-of-possession, NOT website origin (a phishing page can mint its
 *     own session did and claim the same `originHint`). The human-reviewed
 *     field diff produced here is therefore the REAL security boundary — the
 *     consent screen must present it honestly and never imply the request's
 *     origin was verified. See `webSign.ts`'s module doc.
 *   - The app is the only holder of the root key. `approveWebSignRequest`
 *     signs the canonical draft under the ROOT did and refuses when the
 *     draft's own `did` field is not this device's root did (`didMismatch`):
 *     signing a record that claims a did we don't control would mint a
 *     profile that no viewer could ever verify.
 *   - The Face-ID gate is NOT re-implemented here. It lives inside the
 *     injected `rootSigner` (the same `getRootSigner()` signer `saveProfile`
 *     uses — it prompts biometrics on the first `sign()` call and throws on
 *     denial). Callers pass that signer in; `approveWebSignRequest` wraps
 *     every `sign()` in try/catch and reports a denial as `signFailed`
 *     (never an uncaught rejection).
 *
 * This module imports ONLY `@solidarity/shared` (no React Native), so it is
 * unit-testable under bun with a fake in-memory signer.
 */
import {
  buildWebSignResponse,
  signCompact,
  signWebSignResponse,
  verifyWebSignRequest,
  err,
  ok,
  type OutstandingWebSignRequest,
  type ProfileBadge,
  type ProfileLink,
  type ProfileRecord,
  type Result,
  type Signer,
  type WebSignRequestError,
  type WebSignRequestV1,
} from '@solidarity/shared';

// ---------------------------------------------------------------------------
// Diff model — what the request's `draft` changes vs the current local record.
// Purely descriptive: rendered by the consent screen so the user reviews every
// concrete change before Face ID. No trust decision lives here.
// ---------------------------------------------------------------------------

export interface WebSignFieldChange<T> {
  readonly before: T;
  readonly after: T;
  readonly changed: boolean;
}

/** A link whose destination (`url`) is unchanged but whose label was edited. */
export interface WebSignLinkChange {
  readonly url: string;
  readonly before: string;
  readonly after: string;
}

export interface WebSignLinkDiff {
  readonly added: readonly ProfileLink[];
  readonly removed: readonly ProfileLink[];
  readonly changed: readonly WebSignLinkChange[];
}

export interface WebSignStringSetDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface WebSignBadgeDiff {
  readonly added: readonly ProfileBadge[];
  readonly removed: readonly ProfileBadge[];
}

export interface WebSignDiff {
  /** True when there is no current local record — everything is brand new. */
  readonly isInitial: boolean;
  readonly displayName: WebSignFieldChange<string>;
  readonly bio: WebSignFieldChange<string>;
  readonly avatar: WebSignFieldChange<string | null>;
  readonly links: WebSignLinkDiff;
  readonly alsoKnownAs: WebSignStringSetDiff;
  readonly badges: WebSignBadgeDiff;
  /** True iff the draft differs from the current record (always true when initial). */
  readonly hasChanges: boolean;
}

function fieldChange<T>(before: T, after: T): WebSignFieldChange<T> {
  return { before, after, changed: before !== after };
}

function diffLinks(before: readonly ProfileLink[], after: readonly ProfileLink[]): WebSignLinkDiff {
  const beforeByUrl = new Map<string, string>();
  for (const link of before) {
    if (!beforeByUrl.has(link.url)) beforeByUrl.set(link.url, link.label);
  }
  const afterUrls = new Set(after.map((link) => link.url));

  const added: ProfileLink[] = [];
  const changed: WebSignLinkChange[] = [];
  for (const link of after) {
    const previousLabel = beforeByUrl.get(link.url);
    if (previousLabel === undefined) {
      added.push(link);
    } else if (previousLabel !== link.label) {
      changed.push({ url: link.url, before: previousLabel, after: link.label });
    }
  }
  const removed = before.filter((link) => !afterUrls.has(link.url));
  return { added, removed, changed };
}

function diffStringSet(
  before: readonly string[],
  after: readonly string[]
): WebSignStringSetDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = [...new Set(after)].filter((value) => !beforeSet.has(value));
  const removed = [...new Set(before)].filter((value) => !afterSet.has(value));
  return { added, removed };
}

function badgeKey(badge: ProfileBadge): string {
  return JSON.stringify([badge.type, badge.subject, badge.attestation]);
}

function diffBadges(
  before: readonly ProfileBadge[],
  after: readonly ProfileBadge[]
): WebSignBadgeDiff {
  const beforeKeys = new Set(before.map(badgeKey));
  const afterKeys = new Set(after.map(badgeKey));
  const added = after.filter((badge) => !beforeKeys.has(badgeKey(badge)));
  const removed = before.filter((badge) => !afterKeys.has(badgeKey(badge)));
  return { added, removed };
}

function linkDiffTouched(links: WebSignLinkDiff): boolean {
  return links.added.length > 0 || links.removed.length > 0 || links.changed.length > 0;
}

function setDiffTouched(set: WebSignStringSetDiff): boolean {
  return set.added.length > 0 || set.removed.length > 0;
}

function badgeDiffTouched(badges: WebSignBadgeDiff): boolean {
  return badges.added.length > 0 || badges.removed.length > 0;
}

/** True iff any modelled field differs (the `isInitial` case is decided by the caller). */
function diffTouched(
  parts: Pick<WebSignDiff, 'displayName' | 'bio' | 'avatar' | 'links' | 'alsoKnownAs' | 'badges'>
): boolean {
  return (
    parts.displayName.changed ||
    parts.bio.changed ||
    parts.avatar.changed ||
    linkDiffTouched(parts.links) ||
    setDiffTouched(parts.alsoKnownAs) ||
    badgeDiffTouched(parts.badges)
  );
}

/**
 * Compute the per-field diff between the current local record (or `null` on a
 * first-time sign) and the request draft. Pure — no IO, never throws.
 */
export function computeWebSignDiff(
  current: ProfileRecord | null,
  draft: ProfileRecord
): WebSignDiff {
  const parts = {
    displayName: fieldChange(current?.displayName ?? '', draft.displayName),
    bio: fieldChange(current?.bio ?? '', draft.bio),
    avatar: fieldChange<string | null>(current?.avatar ?? null, draft.avatar),
    links: diffLinks(current?.links ?? [], draft.links),
    alsoKnownAs: diffStringSet(current?.alsoKnownAs ?? [], draft.alsoKnownAs),
    badges: diffBadges(current?.badges ?? [], draft.badges),
  };

  return {
    isInitial: current === null,
    ...parts,
    hasChanges: current === null || diffTouched(parts),
  };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** A verified request, its exact signed bytes, and the consent diff. */
export interface WebSignReview {
  /** The exact signed-request compact JWS — carried so `approve` can bind the response to it. */
  readonly jws: string;
  readonly request: WebSignRequestV1;
  readonly diff: WebSignDiff;
}

export interface ReviewWebSignRequestOpts {
  /** The current local Profile Record to diff the draft against (`null`/absent = first sign). */
  readonly currentRecord?: ProfileRecord | null;
  /** Inject "now" (epoch **milliseconds**) for deterministic tests. Defaults to `Date.now()`. */
  readonly nowMs?: number;
  readonly maxAgeSeconds?: number;
  readonly maxSkewSeconds?: number;
}

/**
 * Verify a webSign request (via the shared `verifyWebSignRequest` boundary),
 * then compute the consent diff. Never throws — a bad signature, tampered
 * draft, unknown action, oversize draft, or expired request all surface as the
 * shared `WebSignRequestError` union. Success does NOT prove the request's
 * origin (see module security model); the caller must still show the diff and
 * gate on Face ID.
 */
export function reviewWebSignRequest(
  jws: string,
  opts: ReviewWebSignRequestOpts = {}
): Result<WebSignReview, WebSignRequestError> {
  const verified = verifyWebSignRequest(jws, {
    nowMs: opts.nowMs,
    maxAgeSeconds: opts.maxAgeSeconds,
    maxSkewSeconds: opts.maxSkewSeconds,
  });
  if (!verified.ok) return verified;

  const diff = computeWebSignDiff(opts.currentRecord ?? null, verified.value.draft);
  return ok({ jws, request: verified.value, diff });
}

// ---------------------------------------------------------------------------
// Approve — root-sign the reviewed draft + the bound response
// ---------------------------------------------------------------------------

export type WebSignApproveError =
  | { readonly kind: 'didMismatch'; readonly detail: string }
  | { readonly kind: 'signFailed'; readonly detail: string };

export interface ApproveWebSignRequestOpts {
  /** This device's root did:key — MUST equal the reviewed draft's `did` field. */
  readonly rootDid: string;
  /**
   * The EXISTING Face-ID-gated root signer (`getRootSigner()`'s `Signer`) —
   * injected, never re-implemented. It prompts biometrics on its first
   * `sign()` and throws on denial; a throw is caught here and reported as
   * `signFailed`.
   */
  readonly rootSigner: Signer;
  /** Response envelope issued-at (unix seconds). */
  readonly iat: number;
  /** Response envelope hard expiry (unix seconds). */
  readonly exp: number;
}

/**
 * Root-sign the reviewed draft and return `{ profileJws, responseJws }`:
 *   1. Refuse unless `review.request.draft.did === rootDid` (`didMismatch`) —
 *      never sign a record claiming a did this device doesn't control.
 *   2. `profileJws = signCompact(draft, rootDid, rootSigner)` — the canonical
 *      final Profile Record, root-signed.
 *   3. `responseJws = signWebSignResponse(buildWebSignResponse(...), rootDid,
 *      rootSigner)` — the response envelope, bound to the exact request bytes,
 *      carrying `profileJws`.
 *
 * The two `sign()` calls both go through the injected Face-ID-gated signer;
 * the platform's biometric grace window coalesces them into a single prompt
 * (same as `saveProfile` → publish). Never throws — a denial or signer error
 * is `err({ kind: 'signFailed' })`.
 */
export async function approveWebSignRequest(
  review: WebSignReview,
  opts: ApproveWebSignRequestOpts
): Promise<Result<{ readonly profileJws: string; readonly responseJws: string }, WebSignApproveError>> {
  const draft = review.request.draft;
  if (draft.did !== opts.rootDid) {
    return err({
      kind: 'didMismatch',
      detail: 'the draft claims a did that is not this device root did — refusing to sign',
    });
  }

  let profileJws: string;
  try {
    profileJws = await signCompact(draft, opts.rootDid, opts.rootSigner);
  } catch (e) {
    return err({ kind: 'signFailed', detail: e instanceof Error ? e.message : String(e) });
  }

  const outstanding: OutstandingWebSignRequest = { jws: review.jws, request: review.request };
  const envelope = buildWebSignResponse(outstanding, profileJws, opts.iat, opts.exp);

  let responseJws: string;
  try {
    responseJws = await signWebSignResponse(envelope, opts.rootDid, opts.rootSigner);
  } catch (e) {
    return err({ kind: 'signFailed', detail: e instanceof Error ? e.message : String(e) });
  }

  return ok({ profileJws, responseJws });
}
