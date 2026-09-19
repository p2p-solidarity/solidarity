/**
 * BrandIcon — renders one glyph from the creds-design sprite
 * (`components/icons/brandGlyphs`). Use it wherever a row stands for a
 * PLATFORM; `SfIcon` stays the primitive for interface affordances
 * (chevrons, gears, seals).
 *
 * Filled brand marks take `color` as their fill, stroked UI glyphs as their
 * stroke, so one `color` prop behaves the same way `SfIcon`'s does.
 */
import type { ReactNode } from 'react';
import Svg, { Path } from 'react-native-svg';

import { BRAND_GLYPHS, BRAND_MARK_BOX, type BrandIconName } from './brandGlyphs';

export interface BrandIconProps {
  readonly name: BrandIconName;
  /** Rendered size in points. Matches `SfIcon`'s default. */
  readonly size?: number;
  readonly color?: string;
}

export function BrandIcon({ name, size = 17, color }: BrandIconProps): ReactNode {
  const glyph = BRAND_GLYPHS[name];
  const box = glyph.kind === 'mark' ? BRAND_MARK_BOX : glyph.box;
  const viewBox = `0 0 ${String(box)} ${String(box)}`;
  return (
    <Svg width={size} height={size} viewBox={viewBox} fill="none">
      <Path
        d={glyph.d}
        fill={glyph.kind === 'mark' ? color : 'none'}
        stroke={glyph.kind === 'mark' ? undefined : color}
        strokeWidth={glyph.kind === 'mark' ? undefined : glyph.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
