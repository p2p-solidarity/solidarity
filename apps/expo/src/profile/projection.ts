/**
 * projection.ts — three-tier link privacy → signed Profile Record projections
 * (T7, `notes-1.3.3-publishing-pairing-research.md` §3 / grill G4).
 *
 * Per-item `visibility` is LOCAL only: each link carries a
 * `'public' | 'link-only' | 'private'` tier stored in the profile store's MMKV
 * blob, NEVER in the signed wire record (`packages/shared/src/profile.ts`'s
 * `ProfileRecord` has no `visibility` field — only the OPTIONAL `scope`). From
 * one local profile the app builds THREE projections, each a canonical
 * `ProfileRecord` signed by the SAME root did:key, differing ONLY in which
 * links survive the filter and in the `scope` stamp:
 *
 *   | scope    | links kept                    | transport                         |
 *   |----------|-------------------------------|-----------------------------------|
 *   | public   | `public`                      | Nostr / PDS (published)           |
 *   | shared   | `public` + `link-only`        | QR / URL fragment (direct share)  |
 *   | full     | all (`public`/`link-only`/`private`) | Pear private exchange / local |
 *
 * Only LINKS gain a tier in v1 — identity bindings (`alsoKnownAs`) and
 * `badges` are what make the green check work and are copied verbatim into
 * every projection; `displayName`/`bio`/`avatar`/`updatedAt`/`supersededBy`
 * likewise carry through unchanged. `buildProjection` is PURE (no store, no
 * IO, no signing) so each branch is unit-testable and deterministic; the store
 * (`store.ts`) owns the Face-ID-gated signing of whatever this returns.
 *
 * Back-compat: a link with no visibility entry (a pre-T7 link, or a shorter
 * `linkVisibility` array than `links`) defaults to `'public'` — an untagged
 * link is public, matching how every link behaved before tiers existed.
 */
import type { ProfileRecord, ProfileScope } from '@solidarity/shared';

/** Per-link privacy tier — LOCAL only, never in the signed wire record. */
export type LinkVisibility = 'public' | 'link-only' | 'private';

/** Every visibility value, in editor/preview display order. */
export const LINK_VISIBILITIES: readonly LinkVisibility[] = ['public', 'link-only', 'private'];

/**
 * The link visibilities each published scope INCLUDES. `public` is the
 * narrowest (only public links reach a relay); `shared` widens it to also
 * carry link-only links (someone you handed the QR to); `full` keeps
 * everything (your own source of truth / a mutually-authenticated Pear peer).
 */
const SCOPE_INCLUDES: Record<ProfileScope, ReadonlySet<LinkVisibility>> = {
  public: new Set<LinkVisibility>(['public']),
  shared: new Set<LinkVisibility>(['public', 'link-only']),
  full: new Set<LinkVisibility>(['public', 'link-only', 'private']),
};

/**
 * The local source of truth: the FULL record (every field, all links) plus the
 * per-link visibility tiers, kept parallel to `record.links` by index. A
 * missing/short `linkVisibility` entry means that link is `'public'`.
 */
export interface LocalProfile {
  readonly record: ProfileRecord;
  readonly linkVisibility: readonly LinkVisibility[];
}

/** The visibility tier of the link at `index`, defaulting to `'public'`. */
export function visibilityAt(linkVisibility: readonly LinkVisibility[], index: number): LinkVisibility {
  return linkVisibility[index] ?? 'public';
}

/** Normalize a (possibly absent/short) visibility array to exactly one entry
 *  per link, defaulting each missing entry to `'public'`. */
export function normalizeLinkVisibility(
  links: readonly unknown[],
  provided: readonly LinkVisibility[] | undefined
): LinkVisibility[] {
  return links.map((_, i) => provided?.[i] ?? 'public');
}

/** Whether a scope's projection INCLUDES a link of the given visibility. */
export function scopeIncludes(scope: ProfileScope, visibility: LinkVisibility): boolean {
  return SCOPE_INCLUDES[scope].has(visibility);
}

/**
 * Pure — project `local` to `scope`: keep only the links whose visibility the
 * scope includes, stamp `scope`, and copy every other field verbatim.
 * Deterministic (same input → byte-identical output); does NOT sign.
 */
export function buildProjection(local: LocalProfile, scope: ProfileScope): ProfileRecord {
  const links = local.record.links.filter((_, i) =>
    scopeIncludes(scope, visibilityAt(local.linkVisibility, i))
  );
  return { ...local.record, links, scope };
}

/** Counts of each visibility tier across a local profile's links — the source
 *  of the pre-publish preview's honest "N of M links will be public" copy. */
export interface VisibilitySummary {
  readonly total: number;
  readonly public: number;
  readonly linkOnly: number;
  readonly private: number;
}

export function summarizeVisibility(
  links: readonly unknown[],
  linkVisibility: readonly LinkVisibility[]
): VisibilitySummary {
  const summary = { total: links.length, public: 0, linkOnly: 0, private: 0 };
  for (let i = 0; i < links.length; i++) {
    const v = visibilityAt(linkVisibility, i);
    if (v === 'public') summary.public++;
    else if (v === 'link-only') summary.linkOnly++;
    else summary.private++;
  }
  return summary;
}
