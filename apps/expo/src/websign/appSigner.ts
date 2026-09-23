/**
 * webSign — APP side of the App↔Web per-action remote-signing flow (research
 * notes-1.3.3 §4, grill decisions G3/G4). The shared primitives
 * (`@solidarity/shared`'s `webSign.ts`) own the wire envelopes + the
 * fail-closed verify boundary; this module is the seam the app screen drives:
 *
 *   reviewWebSignRequest(jws)  — verify the request, then compute a per-field
 *                                DIFF (draft vs the PROJECTION of the local
 *                                profile the website could see) for the
 *                                consent UI, plus the link MERGE that folds
 *                                the draft back into the FULL local profile
 *                                on publish. Never throws.
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
 *   - The website edits a PROJECTION, never the full profile (T7 link tiers,
 *     `profile/projection.ts`). A request built from the published page
 *     carries `scope: 'public'` and only ever saw the public links; one built
 *     from a shared fragment carries `'shared'`. Links outside that scope
 *     (link-only / private) were invisible to the website, so their absence
 *     from the draft is NOT a removal: the diff is computed against the same
 *     projection, and `mergeWebSignedLinks` keeps them with their tiers. A
 *     request with no `scope` is treated as `'full'` — every link was
 *     visible, every omission is real. The diff also covers the signed Page
 *     layout, so a request that injects items into a block is shown as such.
 *   - The response envelope still carries the EXACT draft signature (what
 *     the user reviewed). The full local record the phone then saves is the
 *     draft folded over the preserved links; its public projection is
 *     content-identical to the draft the website confirms against.
 *
 * This module imports ONLY `@solidarity/shared` and the pure
 * `@/profile/projection` (no React Native), so it is unit-testable under bun
 * with a fake in-memory signer.
 */
import {
  buildWebSignResponse,
  signCompact,
  signWebSignResponse,
  verifyWebSignRequest,
  err,
  ok,
  stableJSON,
  type OutstandingWebSignRequest,
  type ProfileBadge,
  type ProfileLink,
  type ProfileRecord,
  type ProfileScope,
  type PublicPageDesign,
  type Result,
  type Signer,
  type WebSignRequestError,
  type WebSignRequestV1,
} from '@solidarity/shared';

import {
  buildProjection,
  normalizeLinkVisibility,
  scopeIncludes,
  type LinkVisibility,
  type LocalProfile,
} from '@/profile/projection';

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

/** One Page block item, identified by what a visitor sees and taps. */
export interface WebSignPageItemRef {
  readonly title: string;
  readonly url: string | null;
}

export interface WebSignPageDiff {
  /** True when the signed Page differs at all (layout, appearance, or items). */
  readonly changed: boolean;
  readonly added: readonly WebSignPageItemRef[];
  readonly removed: readonly WebSignPageItemRef[];
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
  readonly page: WebSignPageDiff;
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

function pageItemRefs(page: PublicPageDesign | undefined): WebSignPageItemRef[] {
  if (page === undefined) return [];
  return page.blocks.flatMap((block) =>
    block.items.map((item) => ({ title: item.title, url: item.url ?? null }))
  );
}

function pageItemKey(item: WebSignPageItemRef): string {
  return JSON.stringify([item.title, item.url]);
}

/**
 * Item-level diff of the signed Page plus a whole-page `changed` flag: a
 * request can reorder blocks, restyle them, or swap the appearance without
 * touching a single item, and that must still read as a change to consent to.
 */
function diffPage(
  before: PublicPageDesign | undefined,
  after: PublicPageDesign | undefined
): WebSignPageDiff {
  const beforeItems = pageItemRefs(before);
  const afterItems = pageItemRefs(after);
  const beforeKeys = new Set(beforeItems.map(pageItemKey));
  const afterKeys = new Set(afterItems.map(pageItemKey));
  return {
    changed: stableJSON(before ?? null) !== stableJSON(after ?? null),
    added: afterItems.filter((item) => !beforeKeys.has(pageItemKey(item))),
    removed: beforeItems.filter((item) => !afterKeys.has(pageItemKey(item))),
  };
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
  parts: Pick<WebSignDiff, 'displayName' | 'bio' | 'avatar' | 'links' | 'alsoKnownAs' | 'badges' | 'page'>
): boolean {
  return (
    parts.displayName.changed ||
    parts.bio.changed ||
    parts.avatar.changed ||
    linkDiffTouched(parts.links) ||
    setDiffTouched(parts.alsoKnownAs) ||
    badgeDiffTouched(parts.badges) ||
    parts.page.changed
  );
}

/**
 * Compute the per-field diff between the current local record (or `null` on a
 * first-time sign) and the request draft. Pure — no IO, never throws. Pass the
 * PROJECTION the website could see (`visibleProjection`), not the full local
 * record, so links the website never saw are not reported as removed.
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
    page: diffPage(current?.page, draft.page),
  };

  return {
    isInitial: current === null,
    ...parts,
    hasChanges: current === null || diffTouched(parts),
  };
}

// ---------------------------------------------------------------------------
// Scope + merge — what the website could see, and how the draft folds back
// into the FULL local profile (T7 link tiers are local-only and never travel).
// ---------------------------------------------------------------------------

/**
 * The projection of the local profile the website edited. A request built
 * from the published page carries `scope: 'public'`; one built from a shared
 * fragment carries `'shared'`; a request without a scope (a pasted full
 * record, or a pre-scope website) is treated as `'full'` — every local link
 * was visible, so every omission is a real removal.
 */
export function visibleScopeOf(draft: Pick<ProfileRecord, 'scope'>): ProfileScope {
  return draft.scope ?? 'full';
}

/** The local profile as the website saw it, or `null` on a first-time sign. */
export function visibleProjection(
  current: LocalProfile | null,
  draft: ProfileRecord
): ProfileRecord | null {
  return current === null ? null : buildProjection(current, visibleScopeOf(draft));
}

export interface WebSignLinkMerge {
  /** The full link list to save: the draft's links, then the preserved ones. */
  readonly links: readonly ProfileLink[];
  /** Tiers parallel to `links` (T7, local-only). */
  readonly linkVisibility: readonly LinkVisibility[];
  /**
   * Links the website could not see (outside the request's scope) and so
   * could not have removed — kept with their existing tiers, in local order.
   */
  readonly preserved: readonly ProfileLink[];
}

/**
 * The least-exposed tier a scope still includes: what a link gets when the
 * website (re)added it but its existing local tier would hide it from the very
 * projection the website edited — the user put it on that page, so it must
 * appear there, with no more exposure than that page implies.
 */
function narrowestTierIn(scope: ProfileScope): LinkVisibility {
  switch (scope) {
    case 'public':
      return 'public';
    case 'shared':
      return 'link-only';
    case 'full':
      return 'private';
  }
}

/**
 * Fold the approved draft's links over the FULL local profile. Pure.
 *   - every draft link is kept, in draft order, with its existing local tier
 *     when that tier is visible at the request's scope (else the narrowest
 *     tier the scope includes; a brand-new link is `'public'`);
 *   - every local link OUTSIDE the scope whose URL the draft does not carry is
 *     preserved after them with its tier — the website never saw it.
 */
export function mergeWebSignedLinks(
  current: LocalProfile | null,
  draft: ProfileRecord
): WebSignLinkMerge {
  const scope = visibleScopeOf(draft);
  const currentLinks = current?.record.links ?? [];
  const currentTiers = current
    ? normalizeLinkVisibility(currentLinks, current.linkVisibility)
    : [];

  const tierByUrl = new Map<string, LinkVisibility>();
  currentLinks.forEach((link, index) => {
    if (!tierByUrl.has(link.url)) tierByUrl.set(link.url, currentTiers[index] ?? 'public');
  });

  const links: ProfileLink[] = [];
  const linkVisibility: LinkVisibility[] = [];
  const draftUrls = new Set<string>();
  for (const link of draft.links) {
    draftUrls.add(link.url);
    const existing = tierByUrl.get(link.url);
    links.push(link);
    linkVisibility.push(
      existing === undefined
        ? 'public'
        : scopeIncludes(scope, existing)
          ? existing
          : narrowestTierIn(scope)
    );
  }

  const preserved: ProfileLink[] = [];
  const preservedUrls = new Set<string>();
  currentLinks.forEach((link, index) => {
    const tier = currentTiers[index] ?? 'public';
    if (scopeIncludes(scope, tier) || draftUrls.has(link.url) || preservedUrls.has(link.url)) return;
    preservedUrls.add(link.url);
    preserved.push(link);
    links.push(link);
    linkVisibility.push(tier);
  });

  return { links, linkVisibility, preserved };
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/** A verified request, its exact signed bytes, the consent diff, and the merge. */
export interface WebSignReview {
  /** The exact signed-request compact JWS — carried so `approve` can bind the response to it. */
  readonly jws: string;
  readonly request: WebSignRequestV1;
  readonly diff: WebSignDiff;
  /** The projection the website edited — what `diff` was computed against. */
  readonly scope: ProfileScope;
  /** How the approved draft folds into the FULL local profile on publish. */
  readonly merge: WebSignLinkMerge;
}

export interface ReviewWebSignRequestOpts {
  /** The current local Profile Record to diff the draft against (`null`/absent = first sign). */
  readonly currentRecord?: ProfileRecord | null;
  /** Per-link tiers parallel to `currentRecord.links` (absent/short = `'public'`). */
  readonly currentLinkVisibility?: readonly LinkVisibility[];
  /** Inject "now" (epoch **milliseconds**) for deterministic tests. Defaults to `Date.now()`. */
  readonly nowMs?: number;
  readonly maxAgeSeconds?: number;
  readonly maxSkewSeconds?: number;
}

/**
 * Verify a webSign request (via the shared `verifyWebSignRequest` boundary),
 * then compute the consent diff against the projection the website could see
 * and the merge that folds the draft back into the full profile. Never throws
 * — a bad signature, tampered draft, unknown action, oversize draft, or
 * expired request all surface as the shared `WebSignRequestError` union.
 * Success does NOT prove the request's origin (see module security model);
 * the caller must still show the diff and gate on Face ID.
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

  const draft = verified.value.draft;
  const local: LocalProfile | null = opts.currentRecord
    ? {
        record: opts.currentRecord,
        linkVisibility: normalizeLinkVisibility(opts.currentRecord.links, opts.currentLinkVisibility),
      }
    : null;

  return ok({
    jws,
    request: verified.value,
    diff: computeWebSignDiff(visibleProjection(local, draft), draft),
    scope: visibleScopeOf(draft),
    merge: mergeWebSignedLinks(local, draft),
  });
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
