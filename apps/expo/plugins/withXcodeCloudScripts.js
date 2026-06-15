/**
 * Expo config plugin — re-creates apps/expo/ios/ci_scripts/ci_post_clone.sh
 * after `expo prebuild` wipes the ios/ directory.
 *
 * `@expo/config-plugins` is declared as a direct devDependency of apps/expo
 * (see ./package.json) because bun's symlink-hoisted layout doesn't expose
 * Expo CLI's internal deps to user-authored config plugins.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

const withXcodeCloudScripts = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, 'ci-scripts', 'ci_post_clone.sh');
      const destDir = path.join(projectRoot, 'ios', 'ci_scripts');
      const destPath = path.join(destDir, 'ci_post_clone.sh');

      if (!fs.existsSync(sourcePath)) {
        console.warn(`[withXcodeCloudScripts] missing source: ${sourcePath}`);
        return cfg;
      }
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
      fs.chmodSync(destPath, 0o755);
      console.log(`[withXcodeCloudScripts] copied ${sourcePath} → ${destPath}`);
      return cfg;
    },
  ]);

module.exports = withXcodeCloudScripts;
