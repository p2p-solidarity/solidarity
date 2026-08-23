/**
 * Shared row metrics for the Page tab, taken verbatim from the mock
 * (`creds-design/verified-linkinbio-mock-v3.html` §`#s-page`, including its
 * late P13/P19 overrides): `.field` and `.blk` are borderless rows on
 * `mutedSurface` at r=2, separated by 8pt of space rather than a rule, and
 * `.f-ico` is a 40pt circle on the brand-tinted chip surface.
 */
import type { ViewStyle } from 'react-native';

import { normalizeAtprotoHandle } from '@solidarity/shared';

/** `.field` / `.blk` bottom margin — grouping by space, not by lines. */
export const ROW_GAP = 8;
/** `--radiusCard` for app rows. The public page uses its own per-template radius. */
export const ROW_RADIUS = 2;
/** `.f-ico` — 40pt circle (Figma 737:2837), 22pt glyph. */
export const ICON_TILE_SIZE = 40;

/** Resolve the row reached by a vertical drag. Rounding makes the hand-off
 * happen after crossing half a row; clamping keeps edge drags deterministic. */
export function dragDestinationIndex(
  sourceIndex: number,
  translationY: number,
  itemCount: number,
  rowStride: number,
): number {
  if (itemCount <= 0 || rowStride <= 0) return sourceIndex;
  const destination = sourceIndex + Math.round(translationY / rowStride);
  return Math.max(0, Math.min(itemCount - 1, destination));
}

/** Immutable reorder shared by link and Page-block drag handles. */
export function reorderByIndex<T>(
  items: readonly T[],
  sourceIndex: number,
  destinationIndex: number,
): readonly T[] {
  if (
    sourceIndex === destinationIndex ||
    sourceIndex < 0 ||
    destinationIndex < 0 ||
    sourceIndex >= items.length ||
    destinationIndex >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  if (moved === undefined) return items;
  next.splice(destinationIndex, 0, moved);
  return next;
}

export type RowVerificationPill = 'verified' | 'needsRecheck';

/** Only an affirmative check earns a green pill. A stale completed check can
 * ask for re-verification; declared/revoked results stay unlabelled because
 * calling either one "verified" or merely "waiting" would be dishonest. */
export function verificationPillForStates(
  states: readonly string[],
): RowVerificationPill | null {
  if (states.includes('verified')) return 'verified';
  return states.includes('stale') ? 'needsRecheck' : null;
}

/** `.field` — 64pt row, 12pt gutter between icon / text / trailing glyph. */
export function fieldRowStyle(surface: string): ViewStyle {
  return {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: ROW_RADIUS,
    backgroundColor: surface,
  };
}

/** `.blk` — the same surface at block-row density. */
export function blockRowStyle(surface: string): ViewStyle {
  return {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: ROW_RADIUS,
    backgroundColor: surface,
  };
}

/** `.f-ico` — round, brand-tinted icon tile. */
export function iconTileStyle(surface: string): ViewStyle {
  return {
    width: ICON_TILE_SIZE,
    height: ICON_TILE_SIZE,
    borderRadius: ICON_TILE_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: surface,
  };
}

/**
 * Hosts that render a Nostr profile AT a bare npub. A cached binding proves
 * "this npub is mine"; it says nothing about an unrelated page that merely
 * carries the npub somewhere in its path. Matching any segment on any host
 * would hand a green tick to `example.com/notes/npub1…`.
 */
const NOSTR_PROFILE_HOSTS: ReadonlySet<string> = new Set([
  'njump.me',
  'primal.net',
  'snort.social',
  'iris.to',
  'nostrudel.ninja',
  'coracle.social',
  'nostr.band',
]);

/** Does this URL identify `npub` as a profile, rather than just mention it? */
export function isNostrProfileUrlForNpub(
  url: URL,
  hostname: string,
  path: readonly string[],
  npub: string
): boolean {
  if (url.protocol === 'nostr:') return url.pathname === npub;
  return NOSTR_PROFILE_HOSTS.has(hostname) && path[path.length - 1] === npub;
}

/**
 * Does the record STILL claim this ATProto handle? A cached check describes
 * the handle it ran against; once the record stops claiming it, the result
 * describes nothing the page asserts any more.
 */
export function recordClaimsAtprotoHandle(
  alsoKnownAs: readonly string[],
  handle: string
): boolean {
  const wanted = normalizeAtprotoHandle(handle);
  return alsoKnownAs.some(
    (claim) => claim.startsWith('at://') &&
      normalizeAtprotoHandle(claim.slice('at://'.length)) === wanted
  );
}
