/**
 * Paper stack — empty-state artwork. 1:1 port of
 * solidarity/Views/Common/PaperStackIllustration.swift (Figma node
 * 723:2292): two leaning cream papers with ink outlines, cast shadow
 * wedge, five horizontal text lines on the front sheet, folded corner.
 * Native canvas 214×214; scaled by the SVG viewBox.
 */
import type { ReactNode } from 'react';
import Svg, { G, Path } from 'react-native-svg';

const PAPER_FILL = '#FBF9F2';
const INK = '#2F2F30';

interface Props {
  readonly size?: number;
}

export function PaperStackIllustration({ size = 214 }: Props): ReactNode {
  return (
    <Svg width={size} height={size} viewBox="0 0 214 214">
      {/* Bottom ink stripe (Vector14) */}
      <Path
        d="M102.436 172.183 L169.44 146.075 L169.44 130.712 L160.961 130.712 L83.1 152 Z"
        fill={INK}
      />
      {/* Bottom shadow wedge (Shadow1) */}
      <Path
        d="M71.9 154.4 L145.934 117.966 L148.7 114.8 L121.152 114.8 L28.7 114.8 Z"
        fill={INK}
      />
      {/* Back paper (Paper2) — cream fill + ink stroke */}
      <Path
        d="M72.6785 153.442 L58.0461 32.4434 L133.21 39.4632 L147.997 142.968 Z"
        fill={PAPER_FILL}
        stroke={INK}
        strokeWidth={1}
      />
      {/* Middle shadow wedge (Shadow2) */}
      <Path
        d="M72.7937 57.3872 L83.1 151.6 L101.1 150.4 L90.6914 58.6508 Z"
        fill={INK}
      />
      {/* Front paper body (Paper1 fill) */}
      <Path
        d="M103.524 170.754 L89.1694 49.7925 L152.024 55.6301 L165.126 68.7317 L181.214 158.032 Z"
        fill={PAPER_FILL}
      />
      {/* Front paper outline + folded-corner triangle (Paper1 stroke, open path) */}
      <Path
        d="M152.024 55.6301 L89.1694 49.7925 L103.524 170.754 L181.214 158.032 L165.126 68.7317 M152.024 55.6301 L155.118 67.8007 L165.126 68.7317"
        fill="none"
        stroke={INK}
        strokeWidth={1}
      />
      {/* Five horizontal text lines on front sheet */}
      <G fill={INK}>
        <Path d="M143.348 77.5303 L104.467 76.1001 L105.099 81.1025 L143.947 81.945 Z" />
        <Path d="M106.854 94.9918 L107.288 98.4327 L157.263 97.6252 L156.778 94.6089 Z" />
        <Path d="M158.497 105.293 L157.966 101.994 L107.901 103.279 L108.346 106.805 Z" />
        <Path d="M108.751 110.011 L109.205 113.604 L159.442 111.168 L158.922 107.938 Z" />
        <Path d="M139.366 118.474 L138.895 115.088 L109.616 116.861 L110.079 120.521 Z" />
      </G>
      {/* Folded corner triangle (CornerShape) */}
      <Path
        d="M154.989 67.7745 L152.3 56.3999 L164.833 68.8913 Z"
        fill={INK}
      />
    </Svg>
  );
}
