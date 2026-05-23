/**
 * Tailwind tokens map to Swift `Color.Theme.*` 1:1 so designers can copy
 * names verbatim from SwiftUI to React Native. See
 * solidarity/CLAUDE.md (Tokens section) for the source-of-truth list:
 *   pageBg / cardBg / searchBg / divider / text{1,2,3} / accentRose
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Surfaces — map to Color.Theme.cardSurface()/pageBg/searchBg/etc.
        pageBg: 'var(--color-pageBg, #FFFBF7)',
        cardBg: 'var(--color-cardBg, #FFFFFF)',
        searchBg: 'var(--color-searchBg, #F4F0EA)',
        divider: 'var(--color-divider, #E8E1D8)',

        // Text — map to Color.Theme.textPrimary/Secondary/Tertiary
        text1: 'var(--color-text1, #1A1A1A)',
        text2: 'var(--color-text2, #6B6B6B)',
        text3: 'var(--color-text3, #9C9C9C)',

        // Accents — map to Color.Theme.accentRose/primaryBlue/destructive
        accentRose: 'var(--color-accentRose, #D8466B)',
        primaryBlue: 'var(--color-primaryBlue, #007AFF)',
        destructive: 'var(--color-destructive, #FF3B30)',
        featureAccent: 'var(--color-featureAccent, #5856D6)',

        // Decorative — map to Color.Theme.dustyMauve/blobCenter
        dustyMauve: 'var(--color-dustyMauve, #B89BB1)',
        blobCenter: 'var(--color-blobCenter, #FFE4D6)',

        // Radar
        radarRing: 'var(--color-radarRing, rgba(216, 70, 107, 0.3))',
        radarGlow: 'var(--color-radarGlow, rgba(216, 70, 107, 0.15))',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
