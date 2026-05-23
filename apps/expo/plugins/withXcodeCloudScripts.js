/**
 * Expo config plugin that re-creates apps/expo/ios/ci_scripts/ci_post_clone.sh
 * after `expo prebuild` wipes the ios/ directory. The persistent source lives
 * at apps/expo/ci-scripts/ci_post_clone.sh (tracked in git); this plugin
 * copies it + chmod +x'es it during prebuild so Xcode Cloud can find it.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

const withXcodeCloudScripts = (config) =>
  withDangerousMod(config, [
    'ios',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const sourcePath = path.join(projectRoot, 'ci-scripts', 'ci_post_clone.sh');
      const destDir = path.join(projectRoot, 'ios', 'ci_scripts');
      const destPath = path.join(destDir, 'ci_post_clone.sh');

      if (!fs.existsSync(sourcePath)) {
        console.warn(`[withXcodeCloudScripts] missing source: ${sourcePath}`);
        return config;
      }

      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
      fs.chmodSync(destPath, 0o755);
      console.log(`[withXcodeCloudScripts] copied ${sourcePath} → ${destPath}`);
      return config;
    },
  ]);

module.exports = withXcodeCloudScripts;
