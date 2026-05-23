/**
 * Decorative watermark mirroring solidarity/Views/Common/MauvePetalMotif.swift.
 *
 * Four horseshoe arches at fixed coordinates in a 127.562 × 134.735 viewBox,
 * stamped twice across the hero card — once at the left (off-edge) and once
 * at the right (horizontally mirrored). Rendered at 10% opacity in
 * dustyMauve so the gradient underneath still reads through.
 *
 * Coordinates pinned to the Swift impl byte-for-byte so the visual is
 * identical at the same card width (default Swift hero = 361pt).
 */
import type { ReactNode } from 'react';
import Svg, { G, Path } from 'react-native-svg';

const VB_W = 127.562;
const VB_H = 134.735;
const OUTER_R = 36.35;
const INNER_R = 18.1;
const STEPS = 48;

const DUSTY_MAUVE = '#B89BB1';

interface Arch {
  readonly cx: number;
  readonly cy: number;
  readonly peakUp: boolean;
}

const ARCHES: readonly Arch[] = [
  { cx: 37.36, cy: 38.11, peakUp: true },
  { cx: 91.21, cy: 97.24, peakUp: true },
  { cx: 36.35, cy: 96.63, peakUp: false },
  { cx: 56.58, cy: 42.93, peakUp: false },
];

function horseshoePath(cx: number, cy: number, peakUp: boolean): string {
  const peakRad = peakUp ? -Math.PI / 2 : Math.PI / 2;
  const startRad = peakRad + Math.PI / 2;
  const cmds: string[] = [];

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const angle = startRad - t * Math.PI;
    const x = cx + OUTER_R * Math.cos(angle);
    const y = cy + OUTER_R * Math.sin(angle);
    cmds.push(i === 0 ? `M${String(x.toFixed(2))} ${String(y.toFixed(2))}` : `L${String(x.toFixed(2))} ${String(y.toFixed(2))}`);
  }

  const innerStart = startRad - Math.PI;
  const stepX = cx + INNER_R * Math.cos(innerStart);
  const stepY = cy + INNER_R * Math.sin(innerStart);
  cmds.push(`L${String(stepX.toFixed(2))} ${String(stepY.toFixed(2))}`);

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const angle = innerStart + t * Math.PI;
    const x = cx + INNER_R * Math.cos(angle);
    const y = cy + INNER_R * Math.sin(angle);
    cmds.push(`L${String(x.toFixed(2))} ${String(y.toFixed(2))}`);
  }
  cmds.push('Z');
  return cmds.join(' ');
}

function flowerPath(mirrored: boolean): string {
  return ARCHES.map((a) =>
    horseshoePath(mirrored ? VB_W - a.cx : a.cx, a.cy, a.peakUp)
  ).join(' ');
}

const LEFT_FLOWER = flowerPath(false);
const RIGHT_FLOWER = flowerPath(true);

interface Props {
  readonly cardWidth?: number;
  readonly cardHeight?: number;
  readonly opacity?: number;
  readonly color?: string;
}

export function MauvePetalMotif({
  cardWidth = 361,
  cardHeight = 260,
  opacity = 0.1,
  color = DUSTY_MAUVE,
}: Props): ReactNode {
  const flowerW = cardWidth * (127.562 / 361);
  const flowerH = flowerW * (134.735 / 127.562);
  const topInset = cardWidth * (16.26 / 361);
  const leftX = cardWidth * (-20 / 361);
  const rightX = cardWidth * (263 / 361);

  return (
    <Svg
      width={cardWidth}
      height={cardHeight}
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <G opacity={opacity}>
        <G transform={`translate(${String(leftX)}, ${String(topInset)}) scale(${String(flowerW / VB_W)}, ${String(flowerH / VB_H)})`}>
          <Path d={LEFT_FLOWER} fill={color} />
        </G>
        <G transform={`translate(${String(rightX)}, ${String(topInset)}) scale(${String(flowerW / VB_W)}, ${String(flowerH / VB_H)})`}>
          <Path d={RIGHT_FLOWER} fill={color} />
        </G>
      </G>
    </Svg>
  );
}
