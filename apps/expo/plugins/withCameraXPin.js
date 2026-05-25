/**
 * Expo config plugin — pins Android CameraX to a stable release.
 *
 * react-native-vision-camera@4.7.x hardcodes `camerax_version = "1.5.0-alpha03"`
 * inside its own build.gradle (NOT exposed as a gradle `ext` property), and
 * that alpha release reshuffles `Camera2CameraInfoImpl` so first camera
 * access crashes the JVM with `NoClassDefFoundError`. Forcing a stable
 * 1.4.2 across the whole project tree restores the expected class layout.
 *
 * The override goes into `allprojects { configurations.all { ... } }` so it
 * cascades into vision-camera's own subproject without us patching its
 * `build.gradle` (which lives under node_modules and gets rewritten by
 * `bun install`).
 */
const { withProjectBuildGradle } = require('@expo/config-plugins');

const MARKER = '// [withCameraXPin] BEGIN';
const END = '// [withCameraXPin] END';

const BLOCK = `
  ${MARKER}
  configurations.all {
    resolutionStrategy {
      force 'androidx.camera:camera-core:1.4.2'
      force 'androidx.camera:camera-camera2:1.4.2'
      force 'androidx.camera:camera-lifecycle:1.4.2'
      force 'androidx.camera:camera-video:1.4.2'
      force 'androidx.camera:camera-view:1.4.2'
      force 'androidx.camera:camera-extensions:1.4.2'
    }
  }
  ${END}
`;

function withCameraXPin(config) {
  return withProjectBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    // Inject inside the existing `allprojects { repositories { ... } }` block,
    // immediately after the closing brace of `repositories`.
    src = src.replace(
      /(allprojects\s*\{[\s\S]*?repositories\s*\{[\s\S]*?\n\s*\})/,
      `$1\n${BLOCK}`,
    );
    cfg.modResults.contents = src;
    return cfg;
  });
}

module.exports = withCameraXPin;
