/**
 * Theme-aware colour resolver. Pairs every `*Dark` variant in `Colors.ts`
 * with its light counterpart so consumers can write
 *
 *   const c = useThemeColors();
 *   <View style={{ backgroundColor: c.pageBg, borderColor: c.divider }} />
 *
 * and the values flip when the user toggles Light/Dark or the system
 * scheme changes. `useColorScheme()` already reacts to
 * `Appearance.setColorScheme(...)` writes (root layout forwards the user's
 * preference to RN), so a single subscription drives every consumer.
 *
 * Why a hook and not `Colors.text1` directly? `Colors` is a frozen object
 * of light hex literals — any `style={{ color: Colors.text1 }}` site stays
 * light in dark mode. Components that need to react to scheme must read
 * through this hook (or use NativeWind classes, which pull from CSS vars
 * compiled per scheme).
 */
import { useColorScheme } from 'react-native';

import { Colors } from './Colors';

type ThemeKey =
  | 'pageBg' | 'cardBg' | 'searchBg' | 'divider'
  | 'text1' | 'text2' | 'text3'
  | 'pillBg' | 'pillBorder' | 'pillSurface'
  | 'mutedSurface' | 'chipSurface' | 'featuredCardBg'
  | 'bubbleOutgoing' | 'bubbleIncoming' | 'bubbleIncomingText'
  | 'heroGradientStart' | 'heroGradientEnd'
  | 'gradientCream' | 'blobCenter'
  | 'overlayBg' | 'popupSurface'
  | 'cardSurface' | 'cardBorder';

export type ThemeColors = Readonly<Record<ThemeKey, string>> & {
  readonly invertedButtonBg: string;
  readonly invertedButtonText: string;
  readonly accentRose: string;
  readonly primaryBlue: string;
  readonly primaryMauve: string;
  readonly destructive: string;
  readonly terminalGreen: string;
  readonly warning: string;
  readonly featureAccent: string;
  readonly dustyMauve: string;
  readonly warmCream: string;
  readonly radarRing: string;
  readonly radarGlow: string;
  readonly scheme: 'light' | 'dark';
};

const KEYS: readonly ThemeKey[] = [
  'pageBg', 'cardBg', 'searchBg', 'divider',
  'text1', 'text2', 'text3',
  'pillBg', 'pillBorder', 'pillSurface',
  'mutedSurface', 'chipSurface', 'featuredCardBg',
  'bubbleOutgoing', 'bubbleIncoming', 'bubbleIncomingText',
  'heroGradientStart', 'heroGradientEnd',
  'gradientCream', 'blobCenter',
  'overlayBg', 'popupSurface',
  'cardSurface', 'cardBorder',
];

export function useThemeColors(): ThemeColors {
  const scheme: 'light' | 'dark' = useColorScheme() === 'dark' ? 'dark' : 'light';
  const out: Record<string, string> = {};
  for (const k of KEYS) {
    const darkKey = `${k}Dark` as keyof typeof Colors;
    out[k] = scheme === 'dark' && (Colors[darkKey] as string | undefined)
      ? (Colors[darkKey] as string)
      : (Colors[k] as string);
  }
  // Brand accents (no light/dark variants in source-of-truth)
  out['invertedButtonBg'] = scheme === 'dark' ? Colors.text1Dark : Colors.invertedButtonBg;
  out['invertedButtonText'] = scheme === 'dark' ? Colors.pageBgDark : Colors.invertedButtonText;
  out['accentRose'] = Colors.accentRose;
  out['primaryBlue'] = Colors.primaryBlue;
  out['primaryMauve'] = Colors.primaryMauve;
  out['destructive'] = Colors.destructive;
  out['terminalGreen'] = Colors.terminalGreen;
  out['warning'] = Colors.warning;
  out['featureAccent'] = Colors.featureAccent;
  out['dustyMauve'] = Colors.dustyMauve;
  out['warmCream'] = Colors.warmCream;
  out['radarRing'] = Colors.radarRing;
  out['radarGlow'] = Colors.radarGlow;
  out['scheme'] = scheme;
  return out as unknown as ThemeColors;
}
