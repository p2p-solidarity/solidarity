import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { injectReleaseSigningConfig } = require('../../plugins/withAndroidReleaseSigning.js') as {
  injectReleaseSigningConfig: (src: string) => string;
};

/** The app/build.gradle shape emitted by the Expo template; `sep` is ` = ` (SDK 57+) or ` `. */
function templateGradle(sep: string): string {
  return `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig${sep}signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig${sep}signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;
}

function releaseBuildType(gradle: string): string {
  const start = gradle.indexOf('buildTypes {');
  const release = gradle.indexOf('release {', start);
  return gradle.slice(release, gradle.indexOf('}', release));
}

describe('withAndroidReleaseSigning', () => {
  test.each([
    ['Expo SDK 57+ assignment syntax', ' = '],
    ['legacy space syntax', ' '],
  ])('signs the release build type with the release config (%s)', (_label, sep) => {
    const out = injectReleaseSigningConfig(templateGradle(sep));

    expect(releaseBuildType(out)).toContain('signingConfigs.release');
    expect(releaseBuildType(out)).not.toContain('signingConfigs.debug');
    // The debug build type keeps the debug key.
    expect(out).toContain(`debug {\n            signingConfig${sep}signingConfigs.debug`);
    expect(out.match(/\[withAndroidReleaseSigning\]/g)?.length).toBe(1);
  });

  test('repairs a file already marked by an earlier prebuild whose build type was never switched', () => {
    // Exactly what a non-clean prebuild left behind when the old regex missed ` = `.
    const stale = injectReleaseSigningConfig(templateGradle(' ')).replace(
      /(release \{\n\s+\/\/ Caution![\s\S]*?signingConfig) signingConfigs\.release/,
      '$1 = signingConfigs.debug',
    );
    expect(releaseBuildType(stale)).toContain('signingConfigs.debug');

    const out = injectReleaseSigningConfig(stale);

    expect(releaseBuildType(out)).toContain('signingConfigs.release');
    expect(out.match(/\[withAndroidReleaseSigning\]/g)?.length).toBe(1);
  });

  test('is idempotent', () => {
    const once = injectReleaseSigningConfig(templateGradle(' = '));
    expect(injectReleaseSigningConfig(once)).toBe(once);
  });

  test('fails the prebuild instead of silently shipping a debug-signed release', () => {
    const unknown = templateGradle(' = ').replace(
      /release \{\n(\s+\/\/.*\n){2}\s+signingConfig = signingConfigs\.debug/,
      'release {\n            signingConfig = pickSigning()',
    );
    expect(() => injectReleaseSigningConfig(unknown)).toThrow(/withAndroidReleaseSigning/);
  });
});
