/**
 * Source patches applied to the installed expo-modules-jsi at prebuild so the
 * Xcode Cloud archive compiles on Xcode 27. Each patch is anchored on exact
 * upstream text, is idempotent (a marker string means "already applied"), and
 * throws when the anchor is gone — so an expo-modules-jsi upgrade fails here,
 * at prebuild, instead of five minutes into an Archive.
 *
 * 1. setter-pointer — backport of expo/expo#46736 (shipped in 56.0.13).
 *    `createHostObject` passes `set == nil ? nil : setter` to a C++ initializer
 *    taking an optional C function pointer; relying on the ternary to infer the
 *    `@convention(c)` conversion does not type-check reliably and Xcode 27's Swift
 *    rejects it ("a C function pointer can only be formed from a reference to a
 *    'func' or a literal closure"). Hoisting the setter into an explicitly typed
 *    optional local is the upstream fix.
 *
 * 2. nested-xcodebuild-output — the pod's `Build ExpoModulesJSI xcframework`
 *    phase runs a nested `xcodebuild -quiet`. On Xcode 27 that nested build
 *    prints a spurious "error: the following command failed with exit code 0 but
 *    produced no further output" for a SwiftCompile task that only emitted
 *    warnings, and then succeeds. Replayed verbatim, the line makes the outer
 *    Xcode fail the phase with "Command PhaseScriptExecution emitted errors but
 *    did not return a nonzero exit code to indicate failure" (fatal on the Xcode
 *    Cloud archive, Build 183). The patch captures the nested output; on success
 *    it replays it with error-formatted lines downgraded to warnings (the build
 *    exited 0, so they are not fatal), on failure it prints everything and exits 1.
 *
 * Drop a patch (and its case in __tests__/unit/iosBuildEnv.test.ts) once the
 * installed expo-modules-jsi carries the fix; the marker check makes an applied
 * upstream fix a no-op rather than an error.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const PACKAGE_NAME = 'expo-modules-jsi';

const PATCHES = [
  {
    name: 'setter-pointer',
    file: ['apple', 'Sources', 'ExpoModulesJSI', 'Runtime', 'JavaScriptRuntime.swift'],
    marker: 'setterPointer',
    edits: [
      [
        '    let callbacks = expo.HostObjectCallbacks(context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)',
        [
          '    let setterPointer: (@convention(c) (UnsafeMutableRawPointer, UnsafePointer<CChar>, UnsafeMutableRawPointer) -> Void)? = setter',
          '    let callbacks = expo.HostObjectCallbacks(context, getter, set == nil ? nil : setterPointer, propertyNamesGetter, deallocate)',
        ].join('\n'),
      ],
    ],
  },
  {
    name: 'nested-xcodebuild-output',
    file: ['apple', 'scripts', 'build-xcframework.sh'],
    marker: 'nested_xcodebuild_log',
    edits: [
      [
        '  (cd "$PACKAGE_DIR" && env -i PATH="$PATH" HOME="$HOME" PODS_ROOT="$PODS_ROOT" RN_ROOT="$RN_ROOT" \\\n',
        [
          '  # [airmeishi] Capture the nested xcodebuild. Xcode 27 `-quiet` prints a spurious',
          '  # "error: the following command failed with exit code 0 but produced no further',
          '  # output" for a SwiftCompile task that only emitted warnings; replayed verbatim',
          '  # that line makes the outer Xcode fail this phase with "Command',
          '  # PhaseScriptExecution emitted errors but did not return a nonzero exit code".',
          '  # On success, error-formatted lines are downgraded to warnings (the build',
          '  # exited 0, so they were not fatal); on failure the full log is printed.',
          '  local nested_xcodebuild_log',
          '  nested_xcodebuild_log="$(mktemp -t ExpoModulesJSI-xcodebuild)"',
          '  if ! (cd "$PACKAGE_DIR" && env -i PATH="$PATH" HOME="$HOME" PODS_ROOT="$PODS_ROOT" RN_ROOT="$RN_ROOT" \\',
          '',
        ].join('\n'),
      ],
      [
        '    SWIFT_COMPILATION_MODE=wholemodule \\\n  )\n',
        [
          '    SWIFT_COMPILATION_MODE=wholemodule \\',
          '  ) > "$nested_xcodebuild_log" 2>&1; then',
          '    cat "$nested_xcodebuild_log"',
          '    rm -f "$nested_xcodebuild_log"',
          '    log "error: nested xcodebuild failed for ${platform}"',
          '    exit 1',
          '  fi',
          "  sed -E 's/^((.*: )?)error: /\\1warning: /' \"$nested_xcodebuild_log\"",
          '  rm -f "$nested_xcodebuild_log"',
          '',
        ].join('\n'),
      ],
    ],
  },
];

function resolvePackageRoot(projectRoot) {
  return path.dirname(require.resolve(`${PACKAGE_NAME}/package.json`, { paths: [projectRoot] }));
}

function patchSource(patch, source) {
  if (source.includes(patch.marker)) {
    return { source, status: 'already-patched' };
  }
  let patched = source;
  for (const [from, to] of patch.edits) {
    if (!patched.includes(from)) {
      throw new Error(
        `[withExpoModulesJsiPatches] ${patch.name}: ${patch.file.join('/')} changed shape; remove this patch if the installed expo-modules-jsi already carries the fix, otherwise update its anchor`
      );
    }
    patched = patched.replace(from, to);
  }
  return { source: patched, status: 'patched' };
}

function patchInstalledPackage(projectRoot, packageRoot = resolvePackageRoot(projectRoot)) {
  const statuses = {};
  for (const patch of PATCHES) {
    const filePath = path.join(packageRoot, ...patch.file);
    const { source, status } = patchSource(patch, fs.readFileSync(filePath, 'utf8'));
    if (status === 'patched') {
      fs.writeFileSync(filePath, source);
    }
    console.log(`[withExpoModulesJsiPatches] ${patch.name}: ${status} (${filePath})`);
    statuses[patch.name] = status;
  }
  return statuses;
}

const withExpoModulesJsiPatches = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      patchInstalledPackage(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

module.exports = withExpoModulesJsiPatches;
module.exports._internal = { PATCHES, patchInstalledPackage, patchSource };
