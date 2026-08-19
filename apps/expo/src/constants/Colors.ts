/**
 * Solidarity brand palette — single source of truth for hex literals.
 * Mirrors Swift `Color.Theme.*` (ThemeManager.swift L200-330) so the same
 * name renders the same colour across the SwiftUI legacy build and the
 * Expo port.
 *
 * Dark-mode awareness lives at this layer so every consumer of
 * `Colors.text1`, `Colors.pageBg`, etc. *automatically* picks up the dark
 * variant when the user is in dark mode — without each call site having
 * to wire `useThemeColors()`. The `Colors` export is a Proxy: reading
 * `Colors.text1` consults the current `Appearance.getColorScheme()` and
 * returns `RAW.text1Dark` when the scheme is dark and that override
 * exists; otherwise it falls back to the light token.
 *
 * Why a Proxy (and not just a getter object)?
 *   - Static `const` objects freeze a single value at module-load, so
 *     `style={{ color: Colors.text1 }}` would burn in the boot-time
 *     scheme and never flip.
 *   - A Proxy re-evaluates on every read. NativeWind's StyleSheet
 *     re-compilation already triggers a re-render of every styled
 *     component when `Appearance.setColorScheme(...)` fires, so inline
 *     reads land on the new value the next paint.
 *
 * For React-aware reads (when you need a `useMemo` dep that changes on
 * scheme flips), prefer `useThemeColors()` — it subscribes via
 * `useColorScheme()` and returns a frozen snapshot for the current pass.
 */
import { Appearance } from 'react-native';

const RAW = {
  /** Page background — Palette.cream (#fbf9f2) light / #060417 dark. */
  pageBg: '#FBF9F2',
  pageBgDark: '#060417',

  /** Card / sheet surface — #ffffff / #14101C. */
  cardBg: '#FFFFFF',
  cardBgDark: '#14101C',

  /** Search/input background — #eeeeee / #1C1424. */
  searchBg: '#EEEEEE',
  searchBgDark: '#1C1424',

  /** 1-pt divider line — #d1d1d1 / #2D2438. */
  divider: '#D1D1D1',
  dividerDark: '#2D2438',

  /** Primary text — #2f2f30 / #F0E8F0. */
  text1: '#2F2F30',
  text1Dark: '#F0E8F0',
  /** Secondary text — #5f5e67 / #A898A8. */
  text2: '#5F5E67',
  text2Dark: '#A898A8',
  /** Tertiary text / placeholders — #9c9aa6 / 50% white. */
  text3: '#9C9AA6',
  text3Dark: '#808080',

  /** Pill / chip background — #eeeeee / white@18%. */
  pillBg: '#EEEEEE',
  pillBgDark: 'rgba(255,255,255,0.18)',
  /** Pill / chip border — #d1d1d1 / white@30%. */
  pillBorder: '#D1D1D1',
  pillBorderDark: 'rgba(255,255,255,0.30)',

  /** Featured / hero card surface — #f3ebdd / #83537d. */
  featuredCardBg: '#F3EBDD',
  featuredCardBgDark: '#83537D',

  /** Warm cream for avatar circles / chip surface backings — Figma. */
  warmCream: '#F3EBDD',

  /** Chip / verified-tag surface — #F7F2FA / rgba(47,47,48,0.5). */
  chipSurface: '#F7F2FA',
  chipSurfaceDark: 'rgba(47,47,48,0.5)',

  /** Muted card / row container — #eeeeee@80% / rgba(47,47,48,0.6). */
  mutedSurface: 'rgba(238,238,238,0.8)',
  mutedSurfaceDark: 'rgba(47,47,48,0.6)',

  /** Pill / capsule surface — #eeeeee / rgba(47,47,48,0.5). */
  pillSurface: '#EEEEEE',
  pillSurfaceDark: 'rgba(47,47,48,0.5)',

  /** Outgoing chat bubble — #BF80A7 / #83537D. */
  bubbleOutgoing: '#BF80A7',
  bubbleOutgoingDark: '#83537D',

  /** Incoming chat bubble — #F3EBDD / #7A6F5C. */
  bubbleIncoming: '#F3EBDD',
  bubbleIncomingDark: '#7A6F5C',
  /** Text on the incoming chat bubble — ink in light, white in dark. */
  bubbleIncomingText: '#2F2F30',
  bubbleIncomingTextDark: '#FFFFFF',

  /** Hero card gradient stops (Figma 766:5241 — 17.3°, mauve→peach). */
  heroGradientStart: '#E9E3ED',
  heroGradientStartDark: 'rgba(233,227,237,0.30)',
  heroGradientEnd: '#F3DFDD',
  heroGradientEndDark: 'rgba(243,223,221,0.30)',

  /** Avatar circle background (lavender cream in both modes). */
  gradientCream: '#F0EDF4',
  gradientCreamDark: '#141112',

  /** Inverted button background — text1 (used by Edit / Show buttons). */
  invertedButtonBg: '#2F2F30',
  invertedButtonBgDark: '#F0E8F0',
  invertedButtonText: '#FBF9F2',
  invertedButtonTextDark: '#060417',

  /** Accent rose — primary brand colour (Palette.purple #83537D mauve in dark). */
  accentRose: '#BF80A7',
  /**
   * Brand-tinted "primary" accent for tiles, toggles, badges, switches.
   * Named `primaryBlue` for historical parity with the Swift token, but
   * the Solidarity palette has no blue. Mirrors Swift `Color.Theme.primaryBlue`
   * (ThemeManager.swift:394) — comment in Swift literally reads
   * "Brand mauve (replaces cyber blue as primary accent)".
   *   light: #83537D  (UIColor 0.514, 0.325, 0.490)
   *   dark:  #C088A0  (UIColor 0.75,  0.53,  0.63)
   * Do NOT change to #007AFF or any blue; the brand has none.
   */
  primaryBlue: '#83537D',
  primaryBlueDark: '#C088A0',
  /** Brand mauve — secondary accent. */
  primaryMauve: '#83537D',
  /** Destructive red — Palette.red. */
  destructive: '#CD556A',
  /** Terminal green — success / verified. */
  terminalGreen: '#4CAF51',
  /** 16% green tint for "this is included / verified" fills. Same formula the
   *  creds-design mock uses for `--terminalGreenBg`; pair it with
   *  `terminalGreenText`, which is the contrast-safe foreground. */
  terminalGreenBg: 'rgba(76,175,81,0.16)',
  /** Feature accent purple. */
  featureAccent: '#5856D6',

  /** v1.3.0 per-animal card gradient accents. */
  cardDog: '#FFD54F',
  cardHorse: '#5C6BC0',
  cardPig: '#F06292',
  cardSheep: '#66BB6A',
  cardDove: '#26C6DA',

  /** Decorative — dusty mauve overlay. Mirrors Swift Color.Theme.dustyMauve #A6678D. */
  dustyMauve: '#A6678D',
  /** Decorative — peach centre for blobs / radial gradients. */
  blobCenter: '#FFE4D6',
  blobCenterDark: '#2A1F26',

  /** Radar pulse rings. */
  radarRing: 'rgba(191,128,167,0.3)',
  radarGlow: 'rgba(191,128,167,0.15)',

  /** Warning amber — `Color.Theme.warning` (orange in Swift). */
  warning: '#FF9500',

  /** creds v3 derived accessibility layer — text/glyph foregrounds that must
   * hit WCAG 4.5:1 on the light surfaces (`pageBg` / `cardBg` / 16% tints).
   * Values from creds-design port spec §3.2 (+§10.5 M2 for dark destructive).
   * Fill/tint backgrounds keep the native tokens above; ONLY the foreground
   * text/icon uses these. */
  terminalGreenText: '#2F6B45',
  terminalGreenTextDark: '#4CAF51',
  warningText: '#9C5B00',
  warningTextDark: '#FF9500',
  destructiveText: '#B7364D',
  destructiveTextDark: '#D2677A',
  accentRoseText: '#AA568A',
  accentRoseTextDark: '#BF80A7',
  /** text3 fails 4.5:1 on light surfaces; use this where tertiary text carries
   * meaning (not mere decoration). Dark mode keeps text3Dark. */
  text3Strong: '#747181',
  text3StrongDark: '#808080',

  /** Public Page template palette. These are separate from the app theme:
   * choosing a visitor-facing template must never replace the owner's app UI. */
  pageMint: '#E9F6EF',
  pageRose: '#F6EAEA',
  pageInk: '#26221C',
  pageNight: '#0F1420',
  pageLightText: '#F5F0E4',
  pageGradientStart: '#6E3D5F',
  pageGradientEnd: '#E7A17A',
  pageSunStart: '#FFE9C7',
  pageSunEnd: '#FFD3A0',
  pagePreviewGlass: 'rgba(255,255,255,0.42)',
  pagePreviewBorder: 'rgba(255,255,255,0.58)',

  /** Overlay backdrop for popups — `Color.Theme.overlayBg`. */
  overlayBg: 'rgba(41,26,46,0.45)',
  overlayBgDark: 'rgba(0,0,0,0.65)',

  /** Popup surface — `Color.Theme.popupSurface`. */
  popupSurface: '#FFFFFF',
  popupSurfaceDark: '#120712',

  /** Adaptive card surface — `Color.Theme.cardSurface(for:)`. */
  cardSurface: 'rgba(255,255,255,0.85)',
  cardSurfaceDark: 'rgba(255,255,255,0.05)',

  /** Adaptive card border — `Color.Theme.cardBorder(for:)`. */
  cardBorder: 'rgba(200,184,200,0.6)',
  cardBorderDark: 'rgba(255,255,255,0.10)',

  /** Dim mask painted around a camera-scan window. No dark variant — always over a dark feed. */
  scanDim: 'rgba(0,0,0,0.55)',
  /** Shutter-flash overlay for the screenshot-style capture animation. */
  scanFlash: 'rgba(255,255,255,0.55)',
} as const;

/**
 * Fixed light palette for the visitor-facing Verified Page.
 *
 * A Page's colours are the TEMPLATE ITS OWNER CHOSE, not the reader's app
 * theme — so unlike every other surface these must NOT follow `Appearance`.
 * The creds-design mock resets exactly these tokens back to light inside
 * `#pubFrame` for the same reason ("app 的深淺是你的閱讀偏好，公開頁的深淺
 * 是你替訪客選的模板，兩件事不能混").
 */
export const PageTemplateColors = {
  cardBg: RAW.cardBg,
  divider: RAW.divider,
  searchBg: RAW.searchBg,
  text1: RAW.text1,
  text2: RAW.text2,
  primaryBlue: RAW.primaryBlue,
  warmCream: RAW.warmCream,
  invertedButtonBg: RAW.invertedButtonBg,
  invertedButtonText: RAW.invertedButtonText,
  heroGradientStart: RAW.heroGradientStart,
  heroGradientEnd: RAW.heroGradientEnd,
  pageMint: RAW.pageMint,
  pageRose: RAW.pageRose,
  pageInk: RAW.pageInk,
  pageNight: RAW.pageNight,
  pageLightText: RAW.pageLightText,
  pageGradientStart: RAW.pageGradientStart,
  pageGradientEnd: RAW.pageGradientEnd,
  pageSunStart: RAW.pageSunStart,
  pageSunEnd: RAW.pageSunEnd,
  pagePreviewGlass: RAW.pagePreviewGlass,
  pagePreviewBorder: RAW.pagePreviewBorder,
} as const;

/**
 * The metal card's own palette — a 1:1 port of the creds-design mock's
 * `.metal` faces (`#s-show`). Brushed steel is brushed steel in either theme,
 * so like `PageTemplateColors` these deliberately do NOT follow `Appearance`.
 *
 * `frontStops`/`backStops` are the mock's CSS gradient stops in order, with
 * `frontLocations`/`backLocations` carrying their percentages.
 */
export const CardMetalColors = {
  frontStops: ['#3A3F46', '#6E757E', '#9AA2AB', '#5C636C', '#40454C', '#7C838C', '#A8AFB8', '#565C64', '#383D44'],
  frontLocations: [0, 0.16, 0.27, 0.38, 0.52, 0.66, 0.74, 0.86, 1],
  backStops: ['#33383F', '#5A616A', '#868D96', '#4A5058', '#2E333A'],
  backLocations: [0, 0.3, 0.5, 0.72, 1],
  /** `.etch` — engraved text on steel. */
  etch: '#EDEFF2',
  /** `.etch`'s lower text-shadow; RN supports a single shadow, so this is it. */
  etchShadow: 'rgba(0,0,0,0.55)',
  /** `.metal .face` hairline. */
  faceBorder: 'rgba(255,255,255,0.28)',
  /** `.m-qr` plate and the ink of the code printed on it. */
  qrPlate: 'rgba(236,238,241,0.94)',
  qrInk: '#14161A',
} as const;

type RawKey = keyof typeof RAW;

type ThemeScheme = 'light' | 'dark';

const ADAPTIVE_FOREGROUND_KEYS = [
  'text1',
  'text2',
  'text3',
  'pageBg',
  'cardBg',
  'invertedButtonBg',
  'invertedButtonText',
  'primaryBlue',
] as const satisfies readonly RawKey[];

/**
 * Re-resolve a colour that was read before an Appearance change.
 *
 * NativeWind updates its CSS variables without forcing every parent React
 * component to render again. An inline prop such as `color={Colors.text1}`
 * can therefore still hold the old theme's literal. Theme-aware primitives
 * use this helper to translate either side of an adaptive token pair into the
 * value for the current render. The list is deliberately limited to colours
 * used as interactive foregrounds: some surface and accent tokens share an
 * identical hex, so treating every palette value as interchangeable would
 * make the mapping ambiguous.
 */
export function resolveThemeColor(value: string, scheme: ThemeScheme): string {
  for (const key of ADAPTIVE_FOREGROUND_KEYS) {
    const darkKey = `${key}Dark` as RawKey;
    const lightValue = RAW[key];
    const darkValue = RAW[darkKey];
    if (value === lightValue || value === darkValue) {
      return scheme === 'dark' ? darkValue : lightValue;
    }
  }
  return value;
}

function pick(key: string): string | undefined {
  if (!(key in RAW)) return undefined;
  const scheme = Appearance.getColorScheme();
  if (scheme === 'dark') {
    const darkKey = `${key}Dark` as RawKey;
    if (darkKey in RAW) return RAW[darkKey];
  }
  return RAW[key as RawKey];
}

export const Colors = new Proxy(RAW, {
  get(_, key) {
    if (typeof key !== 'string') return undefined;
    return pick(key);
  },
});

export type ColorToken = RawKey;
