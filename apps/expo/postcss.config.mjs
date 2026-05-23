/**
 * PostCSS config for Tailwind v3 (NativeWind 4.x only supports v3).
 * When NativeWind v5 stable ships with Tailwind v4 support, switch back
 * to @tailwindcss/postcss and bump tailwindcss to ^4.x.
 */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
