/**
 * Expo config plugin — injects the "Stage Passport OpenAC SRS" shell-script
 * build phase into the generated Xcode project.
 *
 * PassportZK.podspec bundles the merged OpenAC v3 SRS
 * (nitro-modules/passport-zk/android/src/main/assets/passport.srs.bin) as a
 * pod resource, but the file is gitignored — this phase re-runs
 * scripts/stage-openac-srs.sh before "[CP] Copy Pods Resources" so local
 * Xcode builds always copy a current SRS. Without this plugin every
 * `expo prebuild` silently dropped the phase (it used to live only in the
 * committed pbxproj) and __tests__/unit/iosBuildEnv.test.ts caught the drift.
 *
 * `@expo/config-plugins` is a direct devDependency of apps/expo (see
 * withXcodeCloudScripts.js for why).
 */
const { withXcodeProject } = require('@expo/config-plugins');

const PHASE_NAME = 'Stage Passport OpenAC SRS';
// Written into the pbxproj as a quoted string: `\n` must land literally
// (Xcode unescapes it), so the JS string carries backslash-n, and the xcode
// lib escapes the embedded double quotes itself.
const SHELL_SCRIPT =
  'set -euo pipefail\\nAPP_DIR="${SRCROOT}/.."\\nAIRMEISHI_EXPO_APP_DIR="$APP_DIR" "$APP_DIR/scripts/stage-openac-srs.sh"\\n';
const INPUT_PATHS = ['"${SRCROOT}/../scripts/stage-openac-srs.sh"'];
const OUTPUT_PATHS = [
  '"${PODS_ROOT}/../../../../nitro-modules/passport-zk/android/src/main/assets/passport.srs.bin"',
];

function hasPhase(project) {
  const phases = project.hash.project.objects['PBXShellScriptBuildPhase'] ?? {};
  return Object.values(phases).some(
    (phase) =>
      phase !== null &&
      typeof phase === 'object' &&
      (phase.name === `"${PHASE_NAME}"` || phase.name === PHASE_NAME)
  );
}

/**
 * The SRS must be on disk before CocoaPods copies pod resources. On a clean
 * prebuild the CP phases don't exist yet (pod install appends them later) so
 * append-order is already correct; on a prebuild over a pod-installed
 * project the fresh phase lands last and must be moved up.
 */
function movePhaseBeforeCopyPodsResources(project, targetUuid) {
  const nativeTargets = project.hash.project.objects['PBXNativeTarget'] ?? {};
  const target = nativeTargets[targetUuid];
  if (!target || !Array.isArray(target.buildPhases)) return;
  const phases = target.buildPhases;
  const srsIndex = phases.findIndex((entry) => entry.comment === PHASE_NAME);
  const copyIndex = phases.findIndex(
    (entry) => entry.comment === '[CP] Copy Pods Resources'
  );
  if (srsIndex === -1 || copyIndex === -1 || srsIndex < copyIndex) return;
  const [srsEntry] = phases.splice(srsIndex, 1);
  phases.splice(copyIndex, 0, srsEntry);
}

const withPassportOpenAcSrsPhase = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const target = project.getFirstTarget();
    if (!hasPhase(project)) {
      const { buildPhase } = project.addBuildPhase(
        [],
        'PBXShellScriptBuildPhase',
        PHASE_NAME,
        target.uuid,
        {
          shellPath: '/bin/bash',
          shellScript: SHELL_SCRIPT,
        }
      );
      buildPhase.inputPaths = INPUT_PATHS;
      buildPhase.outputPaths = OUTPUT_PATHS;
      buildPhase.showEnvVarsInLog = 0;
      console.log(`[withPassportOpenAcSrsPhase] added "${PHASE_NAME}" build phase`);
    }
    movePhaseBeforeCopyPodsResources(project, target.uuid);
    return cfg;
  });

module.exports = withPassportOpenAcSrsPhase;
