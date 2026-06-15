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
        pageBg: 'var(--color-pageBg, #FBF9F2)',
        cardBg: 'var(--color-cardBg, #FFFFFF)',
        searchBg: 'var(--color-searchBg, #EEEEEE)',
        divider: 'var(--color-divider, #D1D1D1)',
        mutedSurface: 'var(--color-mutedSurface, rgba(238,238,238,0.8))',
        pillSurface: 'var(--color-pillSurface, #EEEEEE)',
        pillBg: 'var(--color-pillBg, #EEEEEE)',
        pillBorder: 'var(--color-pillBorder, #D1D1D1)',
        featuredCardBg: 'var(--color-featuredCardBg, #F3EBDD)',
        chipSurface: 'var(--color-chipSurface, #F7F2FA)',
        warmCream: 'var(--color-warmCream, #F3EBDD)',
        invertedButtonBg: 'var(--color-invertedButtonBg, #2F2F30)',
        invertedButtonText: 'var(--color-invertedButtonText, #FBF9F2)',

        // Text — map to Color.Theme.textPrimary/Secondary/Tertiary
        text1: 'var(--color-text1, #2F2F30)',
        text2: 'var(--color-text2, #5F5E67)',
        text3: 'var(--color-text3, #9C9AA6)',

        // Accents — map to Color.Theme.accentRose/primaryBlue/destructive
        // NOTE: `primaryBlue` is brand mauve, NOT iOS system blue — the
        // Solidarity palette has no blue. The token name is preserved
        // verbatim from the Swift source for grep-parity only.
        accentRose: 'var(--color-accentRose, #BF80A7)',
        primaryBlue: 'var(--color-primaryBlue, #83537D)',
        primaryMauve: 'var(--color-primaryMauve, #83537D)',
        destructive: 'var(--color-destructive, #CD556A)',
        terminalGreen: 'var(--color-terminalGreen, #4CAF51)',
        featureAccent: 'var(--color-featureAccent, #5856D6)',

        // Decorative — map to Color.Theme.dustyMauve/blobCenter
        dustyMauve: 'var(--color-dustyMauve, #B89BB1)',
        blobCenter: 'var(--color-blobCenter, #FFE4D6)',

        // Radar
        radarRing: 'var(--color-radarRing, rgba(191,128,167,0.3))',
        radarGlow: 'var(--color-radarGlow, rgba(191,128,167,0.15))',
      },
      borderRadius: {
        sm2: '2px',
        sm3: '3px',
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
