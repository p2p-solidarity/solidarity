/**
 * Solidarity wordmark — rendered from the Swift project's Wordmark.svg
 * (apps/expo/assets/brand/wordmark.svg). Uses react-native-svg's
 * SvgXml so we can ship the original SVG byte-for-byte instead of
 * rasterising at build time.
 */
import { SvgXml } from 'react-native-svg';

// `react-native-svg` reads the SVG via XML string; Metro doesn't support
// `?raw` query imports yet, so we inline the asset here. Kept in sync
// with assets/brand/wordmark.svg by an upcoming codegen step (TODO).
const WORDMARK_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 380 60" role="img" aria-label="Solidarity">
  <text x="0" y="46" font-family="Menlo, monospace" font-size="48" font-weight="700" fill="currentColor">
    solidarity
  </text>
</svg>`;

export function Wordmark({
  width = 240,
  height = 38,
  color = '#1A1A1A',
}: {
  readonly width?: number;
  readonly height?: number;
  readonly color?: string;
}) {
  return <SvgXml xml={WORDMARK_SVG} width={width} height={height} color={color} />;
}
