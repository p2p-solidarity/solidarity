/**
 * Expo config plugin — wires Android release signing + dynamic versionCode
 * so `./gradlew bundleRelease` produces a Play Store–ready AAB without
 * relying on `eas build` to inject credentials.
 *
 * Signing creds and versionCode come from environment variables at prebuild
 * time, populated by `scripts/build-android-local.sh`:
 *
 *   ANDROID_KEYSTORE_PATH        absolute path to release.keystore
 *   ANDROID_KEYSTORE_PASSWORD    store password
 *   ANDROID_KEY_ALIAS            key alias inside the keystore
 *   ANDROID_KEY_PASSWORD         key password
 *   ANDROID_VERSION_CODE         integer, fetched from EAS remote
 *
 * Without those env vars the plugin is a no-op for signing (release falls
 * back to the debug keystore — useful for local dev `expo run:android`).
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = '// [withAndroidReleaseSigning]';

function injectReleaseSigningConfig(src) {
  if (src.includes(MARKER)) return src;

  const releaseBlock = `        release {
            ${MARKER}
            def ks = System.getenv("ANDROID_KEYSTORE_PATH")
            if (ks != null && !ks.isEmpty()) {
                storeFile file(ks)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
`;

  // Insert release { } immediately after the debug { } block inside
  // signingConfigs { }. Pattern matches Expo template output.
  const signingPatched = src.replace(
    /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\n\s{8}\}\n)/,
    `$1${releaseBlock}`,
  );

  // Switch release buildType to use signingConfigs.release.
  return signingPatched.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
    '$1signingConfig signingConfigs.release',
  );
}

function withAndroidReleaseSigning(config) {
  const envVc = process.env.ANDROID_VERSION_CODE;
  if (envVc && /^\d+$/.test(envVc)) {
    config.android = config.android || {};
    config.android.versionCode = parseInt(envVc, 10);
  }

  return withAppBuildGradle(config, (cfg) => {
    cfg.modResults.contents = injectReleaseSigningConfig(cfg.modResults.contents);
    return cfg;
  });
}

module.exports = withAndroidReleaseSigning;
