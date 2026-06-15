/**
 * Why this exists:
 * - Expo SDK 54 with React 19 + react-native-worklets / Reanimated 4 needs
 *   `react-native-worklets/plugin` last in the plugin list.
 * - NativeWind v5 (preview) injects via the `nativewind/babel` preset.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
    plugins: ['react-native-worklets/plugin'],
  };
};
