/**
 * Reads IOS_BUILD_NUMBER env var at prebuild time and writes it to
 * ios.buildNumber → CURRENT_PROJECT_VERSION in the generated pbxproj.
 * Mirrors withAndroidReleaseSigning's ANDROID_VERSION_CODE handling.
 * No-op when env var is missing.
 */
function withIosBuildNumber(config) {
  const envBn = process.env.IOS_BUILD_NUMBER;
  if (envBn && /^\d+$/.test(envBn)) {
    config.ios = config.ios || {};
    config.ios.buildNumber = envBn;
  }
  return config;
}

module.exports = withIosBuildNumber;
