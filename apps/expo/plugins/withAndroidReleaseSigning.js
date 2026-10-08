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

// The release build type's `signingConfig` line. Expo SDK 57's template writes
// the Gradle 9 assignment form (`signingConfig = signingConfigs.debug`); older
// templates omit the `=`. Missing the `=` form once let a release AAB go out
// signed with the template's debug key, which Play rejects.
const RELEASE_BUILD_TYPE_SIGNING =
  /(buildTypes\s*\{[\s\S]*?release\s*\{[^}]*?signingConfig)(\s*=\s*|\s+)signingConfigs\.(\w+)/;

function injectReleaseSigningConfig(src) {
  const withSigningConfig = src.includes(MARKER) ? src : insertReleaseSigningConfig(src);

  // Runs on every prebuild — not only the first — so a file marked by an older
  // plugin version whose build type was never switched gets repaired.
  const match = withSigningConfig.match(RELEASE_BUILD_TYPE_SIGNING);
  if (!withSigningConfig.includes(MARKER) || !match) {
    throw new Error(
      '[withAndroidReleaseSigning] app/build.gradle no longer matches the Expo template ' +
        'this plugin patches; update the plugin rather than ship a debug-signed release.',
    );
  }
  return withSigningConfig.replace(RELEASE_BUILD_TYPE_SIGNING, '$1$2signingConfigs.release');
}

function insertReleaseSigningConfig(src) {
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
  return src.replace(
    /(signingConfigs\s*\{\s*debug\s*\{[\s\S]*?\n\s{8}\}\n)/,
    `$1${releaseBlock}`,
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
module.exports.injectReleaseSigningConfig = injectReleaseSigningConfig;
