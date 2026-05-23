/**
 * Solidarity brand palette — the single source of truth for hex literals.
 * Mirrors Swift `Color.Theme.*` so the same name renders the same colour
 * across the SwiftUI legacy build and the Expo port.
 *
 * Per aniseekr-expo CLAUDE.md rule 4: hex literals are forbidden except
 * for entries in this file (brand source) and contrast.ts (ON_DARK/ON_LIGHT).
 * Always reference via `Colors.<name>` so a future theme switch updates
 * one place.
 */
export const Colors = {
  /** Page background (light). */
  pageBg: '#FFFBF7',
  pageBgDark: '#0F0F12',

  /** Card / sheet surface. */
  cardBg: '#FFFFFF',
  cardBgDark: '#1A1A1F',

  /** Search field background / muted surface. */
  searchBg: '#F4F0EA',
  searchBgDark: '#22222A',

  /** 1-pt divider line. */
  divider: '#E8E1D8',
  dividerDark: '#2A2A33',

  /** Primary text. */
  text1: '#1A1A1A',
  text1Dark: '#F5F5F7',
  /** Secondary text. */
  text2: '#6B6B6B',
  text2Dark: '#A8A8B0',
  /** Tertiary text / placeholders. */
  text3: '#9C9C9C',
  text3Dark: '#6E6E78',

  /** Accent rose — primary brand colour. */
  accentRose: '#D8466B',
  /** iOS-system blue (CTAs that aren't brand-tinted). */
  primaryBlue: '#007AFF',
  /** Destructive red. */
  destructive: '#FF3B30',
  /** Feature accent purple. */
  featureAccent: '#5856D6',

  /** Decorative — dusty mauve overlay. */
  dustyMauve: '#B89BB1',
  /** Decorative — peach centre for blobs / radial gradients. */
  blobCenter: '#FFE4D6',
  blobCenterDark: '#2A1F26',

  /** Radar pulse rings. */
  radarRing: 'rgba(216, 70, 107, 0.3)',
  radarGlow: 'rgba(216, 70, 107, 0.15)',
} as const;

export type ColorToken = keyof typeof Colors;
