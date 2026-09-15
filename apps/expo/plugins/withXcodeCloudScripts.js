/**
 * Expo config plugin — re-creates Xcode Cloud lifecycle hooks under
 * apps/expo/ios/ci_scripts after `expo prebuild` wipes the ios/ directory.
 *
 * `@expo/config-plugins` is declared as a direct devDependency of apps/expo
 * (see ./package.json) because bun's symlink-hoisted layout doesn't expose
 * Expo CLI's internal deps to user-authored config plugins.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('@expo/config-plugins');

function copyScripts(projectRoot) {
  const sourceDir = path.join(projectRoot, 'ci-scripts');
  const destDir = path.join(projectRoot, 'ios', 'ci_scripts');
  if (!fs.existsSync(sourceDir)) {
    console.warn(`[withXcodeCloudScripts] missing source directory: ${sourceDir}`);
    return;
  }

  const scripts = fs
    .readdirSync(sourceDir)
    .filter((name) => name.startsWith('ci_') && name.endsWith('.sh'));
  fs.mkdirSync(destDir, { recursive: true });
  for (const script of scripts) {
    const sourcePath = path.join(sourceDir, script);
    const destPath = path.join(destDir, script);
    fs.copyFileSync(sourcePath, destPath);
    fs.chmodSync(destPath, 0o755);
    console.log(`[withXcodeCloudScripts] copied ${sourcePath} → ${destPath}`);
  }
}

const withXcodeCloudScripts = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      copyScripts(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

module.exports = withXcodeCloudScripts;
module.exports._internal = { copyScripts };
