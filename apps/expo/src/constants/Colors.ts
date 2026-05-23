/**
 * Solidarity brand palette — the single source of truth for hex literals.
 * Mirrors Swift `Color.Theme.*` (ThemeManager.swift L200-330) so the same
 * name renders the same colour across the SwiftUI legacy build and the
 * Expo port.
 *
 * Per aniseekr-expo CLAUDE.md rule 4: hex literals are forbidden except
 * for entries in this file (brand source) and contrast.ts (ON_DARK/ON_LIGHT).
 * Always reference via `Colors.<name>` so a future theme switch updates
 * one place.
 */
export const Colors = {
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
  invertedButtonText: '#FBF9F2',

  /** Accent rose — primary brand colour (Palette.purple #83537D mauve in dark). */
  accentRose: '#BF80A7',
  /** iOS-system blue (CTAs that aren't brand-tinted). */
  primaryBlue: '#007AFF',
  /** Brand mauve — secondary accent. */
  primaryMauve: '#83537D',
  /** Destructive red — Palette.red. */
  destructive: '#CD556A',
  /** Terminal green — success / verified. */
  terminalGreen: '#4CAF51',
  /** Feature accent purple. */
  featureAccent: '#5856D6',

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
} as const;

export type ColorToken = keyof typeof Colors;
