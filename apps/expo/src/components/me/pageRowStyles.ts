/**
 * Shared row metrics for the Page tab, taken verbatim from the mock
 * (`creds-design/verified-linkinbio-mock-v3.html` §`#s-page`, including its
 * late P13/P19 overrides): `.field` and `.blk` are borderless rows on
 * `mutedSurface` at r=2, separated by 8pt of space rather than a rule, and
 * `.f-ico` is a 40pt circle on the brand-tinted chip surface.
 */
import type { ViewStyle } from 'react-native';

/** `.field` / `.blk` bottom margin — grouping by space, not by lines. */
export const ROW_GAP = 8;
/** `--radiusCard` for app rows. The public page uses its own per-template radius. */
export const ROW_RADIUS = 2;
/** `.f-ico` — 40pt circle (Figma 737:2837), 22pt glyph. */
export const ICON_TILE_SIZE = 40;

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
