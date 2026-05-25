/**
 * PassportSketch — stylised passport outline drawn over the camera feed
 * to orient the user during MRZ alignment.
 *
 * The bottom band (`MRZ_BAND_HEIGHT`) is the literal alignment target:
 * it keeps the same 320×60 footprint the old plain `mrzOverlay` used so
 * the existing capture geometry stays valid. The top half is a hand-sketch
 * of the photo + data-field area of an ICAO 9303 passport so the user
 * instinctively knows which way to hold the document.
 *
 * Everything is one static SVG plus a single React conditional on
 * `active` — no per-frame work, no measurement, no camera-pipeline cost.
 * All shapes use `<Path>` (geometry encoded in `d`) rather than
 * `<Rect>`/`<Line>` because the latter's `x`/`y` props are flagged as
 * deprecated by react-native-svg's `TransformProps` inheritance chain.
 *
 * Per CLAUDE.md rule 8 we don't render fake MRZ characters; the band is
 * drawn as empty stroked lines so it's clearly a target, not a guess.
 */
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Colors } from '@/constants/Colors';

const SKETCH_WIDTH = 320;
const SKETCH_TOP_HEIGHT = 150;
const MRZ_BAND_HEIGHT = 60;
const STROKE = 'rgba(255,255,255,0.55)';
const STROKE_STRONG = 'rgba(255,255,255,0.85)';

function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  const innerW = w - 2 * r;
  const innerH = h - 2 * r;
  return `M ${x + r} ${y} h ${innerW} a ${r} ${r} 0 0 1 ${r} ${r} v ${innerH} a ${r} ${r} 0 0 1 ${-r} ${r} h ${-innerW} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-innerH} a ${r} ${r} 0 0 1 ${r} ${-r} z`;
}

function linePath(x1: number, y1: number, x2: number, y2: number): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export interface PassportSketchProps {
  /** Switches the MRZ band stroke to the brand green when a draft is captured. */
  readonly active?: boolean;
}

export function PassportSketch({ active = false }: PassportSketchProps): ReactNode {
  const mrzColor = active ? Colors.terminalGreen : STROKE_STRONG;
  return (
    <View
      style={{
        width: SKETCH_WIDTH,
        height: SKETCH_TOP_HEIGHT + MRZ_BAND_HEIGHT,
        alignItems: 'center',
      }}
      pointerEvents="none"
    >
      <Svg width={SKETCH_WIDTH} height={SKETCH_TOP_HEIGHT}>
        {/* Page outline — top half of an open passport */}
        <Path
          d={roundedRectPath(6, 6, SKETCH_WIDTH - 12, SKETCH_TOP_HEIGHT - 12, 12)}
          stroke={STROKE}
          strokeWidth={1.5}
          fill="transparent"
        />
        {/* Photo placeholder, top-left */}
        <Path
          d={roundedRectPath(22, 22, 64, 84, 4)}
          stroke={STROKE}
          strokeWidth={1.5}
          fill="transparent"
        />
        {/* Data-field lines, right of the photo — each row shorter than the
            last so it reads like written entries trailing off. */}
        {[36, 56, 76, 96].map((y, i) => (
          <Path
            key={i}
            d={linePath(102, y, SKETCH_WIDTH - 30 - i * 18, y)}
            stroke={STROKE}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        ))}
        {/* Footer hint line above the MRZ band */}
        <Path
          d={linePath(22, SKETCH_TOP_HEIGHT - 18, SKETCH_WIDTH - 22, SKETCH_TOP_HEIGHT - 18)}
          stroke={STROKE}
          strokeWidth={1}
          strokeDasharray="3,4"
        />
      </Svg>

      {/* MRZ alignment band — the actual capture target. Two stroked lines
          (no glyphs) make it readable as "two MRZ rows go here" without
          claiming we know what they say. */}
      <Svg width={SKETCH_WIDTH} height={MRZ_BAND_HEIGHT}>
        <Path
          d={roundedRectPath(2, 2, SKETCH_WIDTH - 4, MRZ_BAND_HEIGHT - 4, 8)}
          stroke={mrzColor}
          strokeWidth={2}
          fill="transparent"
        />
        <Path
          d={linePath(14, MRZ_BAND_HEIGHT / 2 - 9, SKETCH_WIDTH - 14, MRZ_BAND_HEIGHT / 2 - 9)}
          stroke={mrzColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="6,5"
        />
        <Path
          d={linePath(14, MRZ_BAND_HEIGHT / 2 + 9, SKETCH_WIDTH - 14, MRZ_BAND_HEIGHT / 2 + 9)}
          stroke={mrzColor}
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="6,5"
        />
      </Svg>
    </View>
  );
}
