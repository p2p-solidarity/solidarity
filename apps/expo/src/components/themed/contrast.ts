/**
 * `readableTextOn(bg)` — picks a foreground colour that meets WCAG AA large
 * contrast (3:1) against the supplied background. Mirrors aniseekr-expo's
 * `components/themed/contrast.ts`, which exists because we shipped a button
 * whose white label was invisible on a light accent.
 *
 * The two universal text colours are the ONLY hex literals allowed in the
 * codebase (per CLAUDE.md rule 4). Everything else must come from `theme.*`
 * tokens via NativeWind.
 */
export const ON_DARK = '#FFFFFF';
export const ON_LIGHT = '#0A0A0A';

/** Parse a `#RRGGBB` (or shorthand `#RGB`) string into `[r, g, b]` in [0, 255]. */
function parseHex(hex: string): readonly [number, number, number] {
  const stripped = hex.startsWith('#') ? hex.slice(1) : hex;
  if (stripped.length === 3) {
    return [
      parseInt(stripped[0]! + stripped[0]!, 16),
      parseInt(stripped[1]! + stripped[1]!, 16),
      parseInt(stripped[2]! + stripped[2]!, 16),
    ];
  }
  if (stripped.length === 6) {
    return [
      parseInt(stripped.slice(0, 2), 16),
      parseInt(stripped.slice(2, 4), 16),
      parseInt(stripped.slice(4, 6), 16),
    ];
  }
  // rgba(...) / other — fall back to mid-grey so the caller never crashes.
  return [128, 128, 128];
}

/** WCAG 2.1 relative luminance. */
function luminance(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(parseHex(fg));
  const l2 = luminance(parseHex(bg));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const WCAG_AA_LARGE = 3;

/**
 * Returns whichever of `ON_DARK` / `ON_LIGHT` gives at least 3:1 contrast
 * against `bg`. Prefers `ON_DARK` (white) when both qualify, matching the
 * Swift app's default. If neither passes (extremely rare — only happens for
 * mid-grey backgrounds), returns whichever is closer.
 */
export function readableTextOn(bg: string): string {
  const whiteRatio = contrastRatio(ON_DARK, bg);
  if (whiteRatio >= WCAG_AA_LARGE) return ON_DARK;
  const darkRatio = contrastRatio(ON_LIGHT, bg);
  if (darkRatio >= WCAG_AA_LARGE) return ON_LIGHT;
  return whiteRatio > darkRatio ? ON_DARK : ON_LIGHT;
}
