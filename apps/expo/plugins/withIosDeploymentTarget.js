/**
 * Expo config plugin — keep every CocoaPods target at the app's iOS minimum.
 *
 * Xcode 27 rejects pod targets below iOS 15 during Archive. Several transitive
 * pods still declare 9.0–12.4 even though the app targets iOS 17, and Expo's
 * Podfile platform alone does not rewrite those per-target build settings.
 * This post_install hook raises only older targets and preserves a pod that
 * deliberately requires a newer iOS version.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const MARKER = '# [withIosDeploymentTarget] BEGIN';
const SNIPPET = `
    ${MARKER}
    minimum_ios = Gem::Version.new(podfile_properties['ios.deploymentTarget'] || '17.0')
    installer.pods_project.targets.each do |pod_target|
      pod_target.build_configurations.each do |configuration|
        current_target = configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        next if current_target && Gem::Version.new(current_target) >= minimum_ios
        configuration.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = minimum_ios.to_s
      end
    end
    # [withIosDeploymentTarget] END
`;

function patchPodfile(contents) {
  if (contents.includes(MARKER)) return contents;

  return contents.replace(
    /(react_native_post_install\([\s\S]*?\n\s*\)\n)/,
    (_match, postInstallCall) => `${postInstallCall}${SNIPPET}`
  );
}

const withIosDeploymentTarget = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn(`[withIosDeploymentTarget] no Podfile at ${podfilePath}`);
        return cfg;
      }
      const contents = fs.readFileSync(podfilePath, 'utf8');
      const patched = patchPodfile(contents);
      if (patched === contents) {
        console.warn('[withIosDeploymentTarget] anchor not found, skipping');
        return cfg;
      }
      fs.writeFileSync(podfilePath, patched);
      console.log('[withIosDeploymentTarget] patched Podfile');
      return cfg;
    },
  ]);

module.exports = withIosDeploymentTarget;
module.exports._internal = { patchPodfile };
