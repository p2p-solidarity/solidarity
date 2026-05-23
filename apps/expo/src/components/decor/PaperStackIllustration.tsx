/**
 * Paper stack — empty-state illustration. Mirrors Swift
 * Views/Common/PaperStackIllustration.swift (Figma SVG conversion).
 * Three stacked rectangles with a faint folded-corner accent.
 */
import type { ReactNode } from 'react';
import Svg, { G, Path, Rect } from 'react-native-svg';

interface Props {
  readonly size?: number;
  readonly color?: string;
  readonly opacity?: number;
}

const DEFAULT_COLOR = '#B89BB1';

export function PaperStackIllustration({
  size = 120,
  color = DEFAULT_COLOR,
  opacity = 0.6,
}: Props): ReactNode {
  // ViewBox: 120 × 120; three sheets, top sheet has a folded corner.
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120">
      <G opacity={opacity}>
        <Rect
          x={26}
          y={42}
          width={68}
          height={64}
          rx={6}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          transform="rotate(-6 60 74)"
        />
        <Rect
          x={22}
          y={34}
          width={68}
          height={64}
          rx={6}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          transform="rotate(2 56 66)"
        />
        <G transform="rotate(0 60 60)">
          <Path
            d="M30 22 H80 L96 38 V92 a6 6 0 0 1 -6 6 H30 a6 6 0 0 1 -6 -6 V28 a6 6 0 0 1 6 -6 Z"
            fill="none"
            stroke={color}
            strokeWidth={1.5}
          />
          <Path
            d="M80 22 V36 a2 2 0 0 0 2 2 H96"
            fill="none"
            stroke={color}
            strokeWidth={1.5}
          />
        </G>
      </G>
    </Svg>
  );
}
