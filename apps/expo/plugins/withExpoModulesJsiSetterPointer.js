/**
 * Backport of expo/expo#46736 (shipped in expo-modules-jsi 56.0.13) onto the
 * installed expo-modules-jsi.
 *
 * `JavaScriptRuntime.createHostObject` passes `set == nil ? nil : setter` to a
 * C++ initializer that takes an optional C function pointer. Relying on the
 * ternary to infer the `@convention(c)` conversion does not type-check reliably:
 * local Xcode 27.0 accepts it, but Xcode Cloud's Xcode 27 Swift rejects it with
 * "a C function pointer can only be formed from a reference to a 'func' or a
 * literal closure" and the Archive dies in ExpoModulesJSI. Hoisting the setter
 * into an explicitly typed optional local is the upstream fix, applied here at
 * prebuild time so `pod install` compiles the patched source.
 *
 * Drop this plugin (and its test in __tests__/unit/iosBuildEnv.test.ts) once
 * expo-modules-jsi >= 56.0.13 is installed; until then it is a no-op on an
 * already-fixed file and fails loudly if the call site changes shape.
 */
const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const PACKAGE_NAME = 'expo-modules-jsi';
const SOURCE_FILE = ['apple', 'Sources', 'ExpoModulesJSI', 'Runtime', 'JavaScriptRuntime.swift'];
const ORIGINAL_LINE =
  '    let callbacks = expo.HostObjectCallbacks(context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)';
const PATCHED_LINES = [
  '    let setterPointer: (@convention(c) (UnsafeMutableRawPointer, UnsafePointer<CChar>, UnsafeMutableRawPointer) -> Void)? = setter',
  '    let callbacks = expo.HostObjectCallbacks(context, getter, set == nil ? nil : setterPointer, propertyNamesGetter, deallocate)',
].join('\n');

function resolvePackageRoot(projectRoot) {
  return path.dirname(require.resolve(`${PACKAGE_NAME}/package.json`, { paths: [projectRoot] }));
}

function patchSource(source) {
  if (source.includes('setterPointer')) {
    return { source, status: 'already-patched' };
  }
  if (!source.includes(ORIGINAL_LINE)) {
    throw new Error(
      '[withExpoModulesJsiSetterPointer] JavaScriptRuntime.swift changed shape; remove this plugin if expo-modules-jsi >= 56.0.13, otherwise update ORIGINAL_LINE'
    );
  }
  return { source: source.replace(ORIGINAL_LINE, PATCHED_LINES), status: 'patched' };
}

function patchInstalledPackage(projectRoot, packageRoot = resolvePackageRoot(projectRoot)) {
  const filePath = path.join(packageRoot, ...SOURCE_FILE);
  const { source, status } = patchSource(fs.readFileSync(filePath, 'utf8'));
  if (status === 'patched') {
    fs.writeFileSync(filePath, source);
  }
  console.log(`[withExpoModulesJsiSetterPointer] ${status}: ${filePath}`);
  return status;
}

const withExpoModulesJsiSetterPointer = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      patchInstalledPackage(cfg.modRequest.projectRoot);
      return cfg;
    },
  ]);

module.exports = withExpoModulesJsiSetterPointer;
module.exports._internal = { patchInstalledPackage, patchSource };
