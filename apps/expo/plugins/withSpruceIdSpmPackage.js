/**
 * Expo config plugin — wires the SpruceID Mobile SDK (Swift Package) into the
 * generated iOS project so the `SolidaritySpruceDid` Nitro pod compiles its
 * `#if canImport(SpruceIDMobileSdkRs)` branch instead of throwing
 * `SpruceDidError.spruceSdkUnavailable` at runtime.
 *
 * Background (the bug this fixes):
 *   `nitro-modules/spruce-did/ios/HybridSpruceDid.swift` guards every did:key
 *   operation (didKeyFromAlias, verifyJws, signCredentialJwt) with
 *   `#if canImport(SpruceIDMobileSdkRs)`. The Rust-backed SDK ships ONLY as a
 *   Swift Package (https://github.com/spruceid/sprucekit-mobile); it is not a
 *   CocoaPod. `SolidaritySpruceDid.podspec` documents that the consuming app
 *   "MUST add this SPM package" and that "For Expo projects, this is wired via
 *   a config plugin (apps/expo/plugins/withSpruceIdSpmPackage.js)". That plugin
 *   was referenced but never authored — so `expo prebuild` regenerated an iOS
 *   project with ZERO SpruceID linkage, `canImport` resolved false, and
 *   "create did:key VC" surfaced "spruceSDK unavailable" in the error sheet's
 *   Technical detail. This file is that missing plugin.
 *
 * Two coordinated edits, both idempotent + survive `expo prebuild --clean`:
 *
 *   1. withXcodeProject — add an XCRemoteSwiftPackageReference to
 *      sprucekit-mobile plus an XCSwiftPackageProductDependency for each
 *      product (SpruceIDMobileSdk + SpruceIDMobileSdkRs), linked into the
 *      `Solidarity` app target's Frameworks build phase. This is what makes
 *      Xcode resolve + build the package.
 *
 *   2. withDangerousMod (Podfile post_install) — the SDK is linked to the APP
 *      target, but the code that imports it lives in the SEPARATE
 *      `SolidaritySpruceDid` pod target. CocoaPods pods don't inherit the
 *      app's SPM module search path, so the pod's Swift compile can't see
 *      `SpruceIDMobileSdkRs` unless we add the shared SwiftPM products dir to
 *      its import paths. We append `${BUILT_PRODUCTS_DIR}` +
 *      `${BUILD_DIR}/${CONFIGURATION}${EFFECTIVE_PLATFORM_NAME}` to the pod
 *      target's SWIFT_INCLUDE_PATHS / FRAMEWORK_SEARCH_PATHS. Mirrors the
 *      post_install technique in withRustXcframeworkSearchPath.js.
 *
 * Version pin: SPM_VERSION matches the example pin in SolidaritySpruceDid.podspec
 * (0.14.10). Confirm against https://github.com/spruceid/sprucekit-mobile/releases
 * and bump if the resolver can't find it — `upToNextMajorVersion` lets patch +
 * minor releases through while holding the major.
 */
const fs = require('node:fs');
const path = require('node:path');

const { withXcodeProject, withDangerousMod } = require('@expo/config-plugins');

const SPM_REPO = 'https://github.com/spruceid/sprucekit-mobile';
const SPM_REPO_NAME = 'sprucekit-mobile';
const SPM_VERSION = '0.14.10';
const SPM_PRODUCTS = ['SpruceIDMobileSdk', 'SpruceIDMobileSdkRs'];
const APP_TARGET_NAME = 'Solidarity';
const POD_TARGET_NAME = 'SolidaritySpruceDid';

// ─── Part 1: add the SPM package + products to the app target ───────────────

function addSpruceSwiftPackage(project) {
  const objects = project.hash.project.objects;
  objects.XCRemoteSwiftPackageReference =
    objects.XCRemoteSwiftPackageReference || {};
  objects.XCSwiftPackageProductDependency =
    objects.XCSwiftPackageProductDependency || {};
  objects.PBXBuildFile = objects.PBXBuildFile || {};

  // Idempotent: bail if a reference to sprucekit-mobile is already present.
  const alreadyWired = Object.entries(objects.XCRemoteSwiftPackageReference).some(
    ([key, value]) =>
      !key.endsWith('_comment') &&
      value &&
      typeof value === 'object' &&
      typeof value.repositoryURL === 'string' &&
      value.repositoryURL.includes(SPM_REPO_NAME)
  );
  if (alreadyWired) {
    console.log('[withSpruceIdSpmPackage] SPM reference already present — skipping');
    return;
  }

  const targetUuid = project.findTargetKey(APP_TARGET_NAME);
  if (!targetUuid) {
    console.warn(
      `[withSpruceIdSpmPackage] app target "${APP_TARGET_NAME}" not found — skipping SPM wiring`
    );
    return;
  }
  const targetObj = project.pbxNativeTargetSection()[targetUuid];
  const frameworksPhase = project.pbxFrameworksBuildPhaseObj(targetUuid);
  if (!targetObj || !frameworksPhase) {
    console.warn(
      '[withSpruceIdSpmPackage] could not resolve target / Frameworks phase — skipping'
    );
    return;
  }

  // 1a. XCRemoteSwiftPackageReference
  const pkgRefUuid = project.generateUuid();
  const pkgRefComment = `XCRemoteSwiftPackageReference "${SPM_REPO_NAME}"`;
  objects.XCRemoteSwiftPackageReference[pkgRefUuid] = {
    isa: 'XCRemoteSwiftPackageReference',
    repositoryURL: `"${SPM_REPO}"`,
    requirement: {
      kind: 'upToNextMajorVersion',
      minimumVersion: SPM_VERSION,
    },
  };
  objects.XCRemoteSwiftPackageReference[`${pkgRefUuid}_comment`] = pkgRefComment;

  // 1b. Register the package reference on the PBXProject.
  const { firstProject } = project.getFirstProject();
  firstProject.packageReferences = firstProject.packageReferences || [];
  firstProject.packageReferences.push({ value: pkgRefUuid, comment: pkgRefComment });

  // 1c. One product dependency + build file per linked product.
  targetObj.packageProductDependencies = targetObj.packageProductDependencies || [];
  frameworksPhase.files = frameworksPhase.files || [];

  for (const product of SPM_PRODUCTS) {
    const depUuid = project.generateUuid();
    objects.XCSwiftPackageProductDependency[depUuid] = {
      isa: 'XCSwiftPackageProductDependency',
      package: pkgRefUuid,
      package_comment: pkgRefComment,
      productName: product,
    };
    objects.XCSwiftPackageProductDependency[`${depUuid}_comment`] = product;

    const buildFileUuid = project.generateUuid();
    const buildFileComment = `${product} in Frameworks`;
    objects.PBXBuildFile[buildFileUuid] = {
      isa: 'PBXBuildFile',
      productRef: depUuid,
      productRef_comment: product,
    };
    objects.PBXBuildFile[`${buildFileUuid}_comment`] = buildFileComment;

    targetObj.packageProductDependencies.push({ value: depUuid, comment: product });
    frameworksPhase.files.push({ value: buildFileUuid, comment: buildFileComment });
  }

  console.log(
    `[withSpruceIdSpmPackage] linked ${SPM_PRODUCTS.join(' + ')} (${SPM_REPO_NAME}@${SPM_VERSION}) into target "${APP_TARGET_NAME}"`
  );
}

const withSpruceSpmPackageRef = (config) =>
  withXcodeProject(config, (cfg) => {
    addSpruceSwiftPackage(cfg.modResults);
    return cfg;
  });

// ─── Part 2: expose the SPM module to the SolidaritySpruceDid pod target ─────

const HOOK_MARKER = '# [withSpruceIdSpmPackage] BEGIN';
const HOOK_END = '# [withSpruceIdSpmPackage] END';

// Adds the shared SwiftPM products directory (where SpruceIDMobileSdkRs's
// .swiftmodule lands once the app target builds the package) to the pod
// target's Swift import + framework search paths. Without this the pod's
// `#if canImport(SpruceIDMobileSdkRs)` stays false even though the package is
// linked to the app.
const HOOK_BODY = `
    ${HOOK_MARKER}
    # The SpruceID SwiftPM products land in the SHARED products dir
    # ($(BUILD_DIR)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)), NOT the pod's
    # own $(BUILT_PRODUCTS_DIR) — under use_frameworks!:static that resolves to
    # the per-pod .../<Pod>/ subdir. SpruceIDMobileSdkRs.swiftmodule sits in the
    # shared dir, and its transitive Rust clang module 'RustFramework' is
    # exposed via <shared>/include/RustFramework/module.modulemap. The pod isn't
    # an SPM target so it inherits none of these — wire them by hand:
    #   • SWIFT_INCLUDE_PATHS  → find SpruceIDMobileSdkRs.swiftmodule (canImport)
    #   • -fmodule-map-file    → resolve the 'RustFramework' clang module that
    #                            SpruceIDMobileSdkRs depends on (else: "missing
    #                            required module 'RustFramework'").
    spm_shared = '$(BUILD_DIR)/$(CONFIGURATION)$(EFFECTIVE_PLATFORM_NAME)'
    rust_modulemap = '-fmodule-map-file=' + spm_shared + '/include/RustFramework/module.modulemap'
    installer.pods_project.targets.each do |t|
      next unless t.name == '${POD_TARGET_NAME}'
      t.build_configurations.each do |config|
        config.build_settings['SWIFT_INCLUDE_PATHS'] =
          '$(inherited) "$(BUILT_PRODUCTS_DIR)" "' + spm_shared + '" "' + spm_shared + '/include"'
        config.build_settings['FRAMEWORK_SEARCH_PATHS'] =
          '$(inherited) "$(BUILT_PRODUCTS_DIR)" "' + spm_shared + '"'
        # Append (don't clobber) so the sibling withDisableClangExplicitModules
        # OTHER_SWIFT_FLAGS survive. Idempotent on re-runs.
        flags = config.build_settings['OTHER_SWIFT_FLAGS']
        flags = flags.is_a?(Array) ? flags.dup : (flags.is_a?(String) ? flags.split(' ') : ['$(inherited)'])
        unless flags.join(' ').include?('RustFramework/module.modulemap')
          flags << '-Xcc' << rust_modulemap
        end
        config.build_settings['OTHER_SWIFT_FLAGS'] = flags
      end
    end
    ${HOOK_END}
`;

const withSprucePodSearchPaths = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.projectRoot, 'ios', 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        console.warn(`[withSpruceIdSpmPackage] missing ${podfilePath}`);
        return cfg;
      }
      let original = fs.readFileSync(podfilePath, 'utf8');
      // Self-updating: if a PRIOR version of our block is present, strip it so
      // the current HOOK_BODY is re-injected. `expo prebuild` without --clean
      // reuses the Podfile, so a "skip if marker present" check would freeze a
      // stale hook in place (this is exactly what shipped the wrong RustFramework
      // wiring). Removing + re-adding keeps the block in sync with this file.
      if (original.includes(HOOK_MARKER)) {
        const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
        const blockRe = new RegExp(
          `\\n?[^\\n]*${esc(HOOK_MARKER)}[\\s\\S]*?${esc(HOOK_END)}[^\\n]*\\n?`,
          'u'
        );
        const stripped = original.replace(blockRe, '\n');
        if (stripped === original) {
          console.warn(
            '[withSpruceIdSpmPackage] existing hook present but not cleanly removable — leaving as-is'
          );
          return cfg;
        }
        original = stripped;
      }
      // Inject just before the closing `end` of the post_install block — the
      // Expo-generated Podfile contains exactly one such block.
      const closingRegex = /(\n\s*)end\n(\s*)end\n$/;
      if (!closingRegex.test(original)) {
        console.warn(
          '[withSpruceIdSpmPackage] could not find post_install closing brace'
        );
        return cfg;
      }
      const patched = original.replace(
        closingRegex,
        `${HOOK_BODY}$1end\n$2end\n`
      );
      fs.writeFileSync(podfilePath, patched);
      console.log(
        `[withSpruceIdSpmPackage] injected ${POD_TARGET_NAME} SPM search-path post_install hook`
      );
      return cfg;
    },
  ]);

module.exports = (config) =>
  withSprucePodSearchPaths(withSpruceSpmPackageRef(config));

// Exposed for the prebuild dry-run / unit checks (see plugins validation).
module.exports.addSpruceSwiftPackage = addSpruceSwiftPackage;
module.exports.HOOK_MARKER = HOOK_MARKER;
