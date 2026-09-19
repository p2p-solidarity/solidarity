import { afterEach, describe, expect, test } from 'bun:test';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const appDir = resolve(import.meta.dir, '../..');
const repoRoot = resolve(appDir, '../..');
const prepareScript = join(appDir, 'scripts', 'prepare-ios-workspace.sh');
const stageOpenAcSrsScript = join(appDir, 'scripts', 'stage-openac-srs.sh');
const normalizeSchemeScript = join(appDir, 'scripts', 'normalize-ios-scheme.sh');
const cloudPostCloneScript = join(appDir, 'ci-scripts', 'ci_post_clone.sh');
const precompiledResizerPluginPath = join(
  appDir,
  'plugins',
  'withPrecompiledVisionCameraResizerMetal.js'
);
const precompiledResizerLibrary = join(
  appDir,
  'native-assets',
  'VisionCameraResizer',
  'default.metallib'
);
const jsiPatchesPluginPath = join(appDir, 'plugins', 'withExpoModulesJsiPatches.js');
const appConfig = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')) as {
  readonly expo: { readonly plugins: readonly (string | readonly unknown[])[] };
};
const prepareScriptSource = readFileSync(prepareScript, 'utf8');
const stageOpenAcSrsScriptSource = readFileSync(stageOpenAcSrsScript, 'utf8');
const normalizeSchemeScriptSource = readFileSync(normalizeSchemeScript, 'utf8');
const require = createRequire(import.meta.url);
const disableClangExplicitModulesPlugin = require(
  join(appDir, 'plugins', 'withDisableClangExplicitModules.js')
);
const iosDeploymentTargetPlugin = require(
  join(appDir, 'plugins', 'withIosDeploymentTarget.js')
);
const generatedSchemeXml = readFileSync(
  join(appDir, 'ios', 'Solidarity.xcodeproj', 'xcshareddata', 'xcschemes', 'solidarity.xcscheme'),
  'utf8'
);
const xcodeProject = readFileSync(
  join(appDir, 'ios', 'Solidarity.xcodeproj', 'project.pbxproj'),
  'utf8'
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'airmeishi-ios-build-'));
  tempDirs.push(dir);
  return dir;
}

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o755 });
}

function createFakeToolchain(binDir: string, logPath: string): void {
  mkdirSync(binDir, { recursive: true });
  const loggingStub = `#!/usr/bin/env bash
set -euo pipefail
command_name="$(basename "$0")"
printf '%s\\t%s\\t%s\\n' "$command_name" "$PWD" "$*" >> "${logPath}"
if [[ "$command_name" == "bunx" && "$*" == expo\\ prebuild* && "\${AIRMEISHI_FAKE_PREBUILD_NO_SCHEME:-0}" != "1" ]]; then
  scheme_dir="$PWD/ios/Solidarity.xcodeproj/xcshareddata/xcschemes"
  mkdir -p "$scheme_dir"
  printf '${generatedSchemeXml.replace(/\n/g, '\\n')}' > "$scheme_dir/Solidarity.xcscheme"
fi
exit 0
`;

  for (const command of ['node', 'bun', 'bunx', 'pod']) {
    writeExecutable(join(binDir, command), loggingStub);
  }
  writeExecutable(
    join(binDir, 'brew'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'brew should not be called when required tools are already on PATH\\n' >&2
exit 42
`
  );
}

function writeNativeBindingDownloadStubs(binDir: string, logPath: string): void {
  writeExecutable(
    join(binDir, 'curl'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'curl\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
out=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--output" || "$prev" == "-o" ]]; then
    out="$arg"
    break
  fi
  prev="$arg"
done
if [[ -z "$out" ]]; then
  echo "curl stub did not receive --output" >&2
  exit 2
fi
mkdir -p "$(dirname "$out")"
printf 'fake zip' > "$out"
`
  );

  writeExecutable(
    join(binDir, 'unzip'),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'unzip\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
zip=""
dest=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "-d" ]]; then
    dest="$arg"
  elif [[ "$arg" != -* && -z "$zip" ]]; then
    zip="$arg"
  fi
  prev="$arg"
done
if [[ -z "$zip" || -z "$dest" ]]; then
  echo "unzip stub expected ZIP and -d DEST" >&2
  exit 2
fi
if [[ "$zip" == *passport* ]]; then
  root="$dest/MoproBindings.xcframework"
  module="passport_zk_mopro"
  lib="libpassport_zk_mopro.a"
  header="passport_zk_moproFFI.h"
else
  root="$dest/SemaphoreSwift-fixture/Sources/MoproiOSBindings/MoproBindings.xcframework"
  module="semaphore_bindings"
  lib="libsemaphore_bindings.a"
  header="semaphore_bindingsFFI.h"
fi
for slice in ios-arm64 ios-arm64-simulator; do
  mkdir -p "$root/$slice/Headers/$module"
  printf 'fake lib' > "$root/$slice/$lib"
  printf 'module %sFFI { header "%s" export * }\\n' "$module" "$header" > "$root/$slice/Headers/$module/module.modulemap"
  printf 'void stub(void);\\n' > "$root/$slice/Headers/$module/$header"
done
printf '<plist></plist>\\n' > "$root/Info.plist"
`
  );
}

function readCommandLog(logPath: string): string[] {
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
}

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function writeGeneratedScheme(appDir: string): string {
  const schemeDir = join(appDir, 'ios', 'Solidarity.xcodeproj', 'xcshareddata', 'xcschemes');
  const schemePath = join(schemeDir, 'Solidarity.xcscheme');
  mkdirSync(schemeDir, { recursive: true });
  writeFileSync(schemePath, generatedSchemeXml);
  return schemePath;
}

describe('iOS build environment scripts', () => {
  test('test fixture paths resolve to the Expo app', () => {
    expect(existsSync(prepareScript), prepareScript).toBe(true);
    expect(existsSync(stageOpenAcSrsScript), stageOpenAcSrsScript).toBe(true);
    expect(existsSync(cloudPostCloneScript), cloudPostCloneScript).toBe(true);
  });

  test('disable explicit modules plugin preserves pod-managed xcconfig flags', () => {
    const podfile = `post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end
end
`;

    const patched = disableClangExplicitModulesPlugin._internal.patchPodfile(podfile);

    expect(patched).toContain('Regexp.last_match(1)');
    expect(patched).not.toContain('OTHER_CFLAGS = #{react_native_post_install(');
    expect(patched).not.toContain('OTHER_SWIFT_FLAGS = #{react_native_post_install(');
  });

  test('deployment-target plugin raises every older Pod target to the app minimum', () => {
    const podfile = `platform :ios, podfile_properties['ios.deploymentTarget'] || '16.4'
target 'Solidarity' do
  post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
    )
  end
end
`;

    const patched = iosDeploymentTargetPlugin._internal.patchPodfile(podfile);

    expect(patched).toContain('# [withIosDeploymentTarget] BEGIN');
    expect(patched).toContain("podfile_properties['ios.deploymentTarget'] || '17.0'");
    expect(patched).toContain("build_settings['IPHONEOS_DEPLOYMENT_TARGET']");
    expect(patched).toContain('Gem::Version.new(current_target) >= minimum_ios');
    expect(iosDeploymentTargetPlugin._internal.patchPodfile(patched)).toBe(patched);
    expect(appConfig.expo.plugins).toContain('./plugins/withIosDeploymentTarget.js');

    const deploymentThenModules = disableClangExplicitModulesPlugin._internal.patchPodfile(patched);
    const modulesThenDeployment = iosDeploymentTargetPlugin._internal.patchPodfile(
      disableClangExplicitModulesPlugin._internal.patchPodfile(podfile)
    );
    for (const combined of [deploymentThenModules, modulesThenDeployment]) {
      expect(combined).toContain('# [withIosDeploymentTarget] BEGIN');
      expect(combined).toContain('# [withDisableClangExplicitModules] BEGIN');
    }
  });

  test('iOS project bundles the single merged OpenAC SRS resource', () => {
    expect(xcodeProject).toContain(
      'nitro-modules/attest/android/src/main/assets/passport.srs.bin'
    );
    expect(xcodeProject).toContain(
      '${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/passport.srs.bin'
    );
    expect(xcodeProject.indexOf('Stage Passport OpenAC SRS')).toBeGreaterThan(-1);
    expect(xcodeProject.indexOf('Stage Passport OpenAC SRS')).toBeLessThan(
      xcodeProject.indexOf('[CP] Copy Pods Resources')
    );
    expect(xcodeProject).toContain('scripts/stage-openac-srs.sh');
    expect(xcodeProject).not.toContain('dsc_chain.srs.bin');
    expect(xcodeProject).not.toContain('passport_adapter.srs.bin');
    expect(xcodeProject).not.toContain('openac_show.srs.bin');
  });

  test('prepare script stages OpenAC SRS locally, with a SHA-pinned release fallback', () => {
    expect(prepareScriptSource).toContain('stage-openac-srs.sh');
    // The retired per-circuit SRS zip must not come back.
    expect(prepareScriptSource).not.toContain('PASSPORT_OPENAC_SRS_ZIP_URL');
    expect(prepareScriptSource).not.toContain('PassportOpenAcV3Srs.zip');
    // Fresh checkouts (Xcode Cloud) download the merged SRS attached to the
    // passport-noir release — pinned by SHA-256 so the proving key cannot
    // drift silently.
    expect(prepareScriptSource).toContain(
      'releases/download/${PASSPORT_MOPRO_VERSION}/passport.srs.bin'
    );
    expect(prepareScriptSource).toMatch(
      /PASSPORT_OPENAC_SRS_SHA256="\$\{AIRMEISHI_PASSPORT_OPENAC_SRS_SHA256-[0-9a-f]{64}\}"/
    );
    // The staging helper doubles as an Xcode build phase and must stay
    // offline — downloads live in prepare-ios-workspace.sh only.
    expect(stageOpenAcSrsScriptSource).not.toContain('curl');
    expect(stageOpenAcSrsScriptSource).toContain(
      'intentionally does not download anything'
    );
  });

  test('OpenAC SRS staging promotes the largest legacy SRS when merged SRS is absent', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const passportNoirDir = join(fixtureRoot, 'passport-noir');
    const localSrsDir = join(passportNoirDir, 'mopro-binding', 'test-vectors', 'srs');
    const assetsDir = join(
      fixtureRoot,
      'nitro-modules',
      'attest',
      'android',
      'src',
      'main',
      'assets'
    );
    mkdirSync(join(fixtureApp, 'ios'), { recursive: true });
    mkdirSync(localSrsDir, { recursive: true });
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(join(localSrsDir, 'dsc_chain.srs.bin'), 'small');
    writeFileSync(join(localSrsDir, 'passport_adapter.srs.bin'), 'largest local srs');
    writeFileSync(join(localSrsDir, 'openac_show.srs.bin'), 'medium srs');
    writeFileSync(join(assetsDir, 'passport_adapter.srs.bin'), 'stale');

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        stageOpenAcSrsScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_PASSPORT_NOIR_DIR: passportNoirDir,
        AIRMEISHI_REPO_ROOT: fixtureRoot,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    expect(readFileSync(join(assetsDir, 'passport.srs.bin'), 'utf8')).toBe(
      'largest local srs'
    );
    expect(existsSync(join(assetsDir, 'passport_adapter.srs.bin'))).toBe(false);
  });

  test('shared prepare script runs workspace install, clean prebuild, and pod install', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    mkdirSync(join(fixtureApp, 'ios'), { recursive: true });
    createFakeToolchain(fakeBin, logPath);

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_IOS_PREBUILD_CLEAN: '1',
        AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS: '0',
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        COMMAND_LOG: logPath,
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    expect(readCommandLog(logPath)).toEqual([
      `node\t${fixtureRoot}\t-e const [maj,min]=process.versions.node.split('.').map(Number); process.exit(maj > 20 || (maj === 20 && min >= 18) ? 0 : 1)`,
      `bun\t${fixtureRoot}\tinstall --frozen-lockfile`,
      `node\t${fixtureRoot}\t-p process.arch`,
      `bun\t${fixtureRoot}\t-e process.stdout.write(process.arch)`,
      `node\t${fixtureApp}\t-e require('${fixtureApp}/metro.config.js'); process.exit(0)`,
      `bunx\t${fixtureApp}\texpo prebuild --clean --platform ios --no-install`,
      `pod\t${join(fixtureApp, 'ios')}\tinstall`,
    ]);
  });

  // Layer 3 of the bundle-node defense (see prepare-ios-workspace.sh): when
  // the metro.config.js probe fails and no arch-matched node could be staged,
  // the script must self-heal the one known bundle-time native dep by staging
  // the lightningcss platform package for node's arch from the npm registry.
  test('shared prepare script stages the lightningcss binding when the bundle probe fails', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    mkdirSync(join(fixtureApp, 'ios'), { recursive: true });
    createFakeToolchain(fakeBin, logPath);

    const lightningcssDir = join(fixtureRoot, 'node_modules', 'lightningcss');
    mkdirSync(lightningcssDir, { recursive: true });
    writeFileSync(
      join(lightningcssDir, 'package.json'),
      JSON.stringify({ name: 'lightningcss', version: '9.9.9' })
    );

    const stagedBinding = join(fixtureRoot, 'node_modules', 'lightningcss-fake-arch', 'binding.node');
    const probeCommand = `-e require('${fixtureApp}/metro.config.js'); process.exit(0)`;
    // node loads the metro config chain only once the platform package
    // exists — mirrors the real resolution failure on Xcode Cloud. Arch
    // probes print nothing, so node and bun agree and no node is staged.
    writeExecutable(
      join(fakeBin, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'node\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
case "$*" in
  *metro.config.js*) [[ -f "${stagedBinding}" ]] || exit 1 ;;
  *"package.json').version"*) printf '9.9.9' ;;
  *"process.platform + '-' + process.arch"*) printf 'fake-arch' ;;
esac
exit 0
`
    );
    // npm pack drops the requested platform tarball (package/ root) into $PWD.
    writeExecutable(
      join(fakeBin, 'npm'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'npm\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
mkdir -p package
printf 'fake native binding' > package/binding.node
printf '{"name":"lightningcss-fake-arch"}' > package/package.json
tar -czf lightningcss-fake-arch-9.9.9.tgz package
rm -rf package
`
    );

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS: '0',
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        COMMAND_LOG: logPath,
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    const commands = readCommandLog(logPath);
    expect(commands.some((line) => line.includes('pack lightningcss-fake-arch@9.9.9'))).toBe(true);
    expect(existsSync(stagedBinding)).toBe(true);
    expect(readFileSync(stagedBinding, 'utf8')).toBe('fake native binding');
    // The staged package must satisfy a fresh metro.config probe before prebuild.
    expect(
      commands.filter((line) => line === `node\t${fixtureApp}\t${probeCommand}`).length
    ).toBe(2);
    // Archs agreed, so no node override may be written.
    expect(existsSync(join(fixtureApp, 'ios', '.xcode.env.local'))).toBe(false);
  });

  // Layer 1 of the bundle-node defense: when node's arch differs from bun's,
  // the prepare script downloads the SHA-pinned nodejs.org build matching
  // bun's arch and points the RN bundle phase at it via ios/.xcode.env.local
  // (written after prebuild, which wipes ios/).
  test('shared prepare script stages an arch-matched node and writes .xcode.env.local when node and bun disagree', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const nodeCacheDir = join(fixtureRoot, 'node-cache');
    mkdirSync(join(fixtureApp, 'ios'), { recursive: true });
    createFakeToolchain(fakeBin, logPath);

    // PATH node reports x64, bun reports arm64 — the Build 153/154 mismatch.
    writeExecutable(
      join(fakeBin, 'node'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'node\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
case "$*" in
  "-p process.arch") printf 'x64' ;;
  "-p process.platform") printf 'darwin' ;;
esac
exit 0
`
    );
    writeExecutable(
      join(fakeBin, 'bun'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'bun\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
if [[ "$*" == *process.arch* ]]; then
  printf 'arm64'
fi
exit 0
`
    );
    // The staged node must be exercised by the probe — make it self-identify.
    const stagedNodeTemplate = join(fixtureRoot, 'staged-node-template');
    writeExecutable(
      stagedNodeTemplate,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'staged-node\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
exit 0
`
    );
    // curl serves the pinned Node tarball (top-level dir + bin/node layout).
    writeExecutable(
      join(fakeBin, 'curl'),
      `#!/usr/bin/env bash
set -euo pipefail
printf 'curl\\t%s\\t%s\\n' "$PWD" "$*" >> "${logPath}"
out=""
prev=""
for arg in "$@"; do
  if [[ "$prev" == "--output" ]]; then
    out="$arg"
    break
  fi
  prev="$arg"
done
if [[ -z "$out" ]]; then
  echo "curl stub did not receive --output" >&2
  exit 2
fi
mkdir -p "$(dirname "$out")"
work="$(mktemp -d)"
mkdir -p "$work/nodefixture/bin"
cp "${stagedNodeTemplate}" "$work/nodefixture/bin/node"
tar -czf "$out" -C "$work" nodefixture
rm -rf "$work"
`
    );

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_MATCHED_NODE_BASE_URL: 'https://example.invalid/dist',
        AIRMEISHI_MATCHED_NODE_CACHE_DIR: nodeCacheDir,
        AIRMEISHI_MATCHED_NODE_SHA256_DARWIN_ARM64: '',
        AIRMEISHI_MATCHED_NODE_VERSION: 'v9.9.9',
        AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS: '0',
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        COMMAND_LOG: logPath,
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    const commands = readCommandLog(logPath);
    const stagedNode = join(nodeCacheDir, 'node-v9.9.9-darwin-arm64', 'bin', 'node');
    expect(
      commands.some((line) =>
        line.includes('https://example.invalid/dist/v9.9.9/node-v9.9.9-darwin-arm64.tar.gz')
      )
    ).toBe(true);
    expect(existsSync(stagedNode)).toBe(true);
    // The metro.config probe must run on the staged node, not the PATH node.
    expect(commands).toContain(
      `staged-node\t${fixtureApp}\t-e require('${fixtureApp}/metro.config.js'); process.exit(0)`
    );
    // The bundle phase override lands after prebuild regenerates ios/.
    const xcodeEnvLocal = join(fixtureApp, 'ios', '.xcode.env.local');
    expect(existsSync(xcodeEnvLocal)).toBe(true);
    expect(readFileSync(xcodeEnvLocal, 'utf8')).toBe(`export NODE_BINARY=${stagedNode}\n`);
    // Probe passed on the matched node — the npm self-heal must not fire.
    expect(commands.some((line) => line.startsWith('npm'))).toBe(false);
  });

  // Xcode Cloud's workflow archives the lowercase `solidarity` scheme. Expo
  // prebuild regenerates `Solidarity.xcscheme`, so normalize_xcode_cloud_scheme
  // repairs that casing before Xcode Cloud starts its archive action.
  test('shared prepare script normalizes the Expo-generated scheme to Xcode Cloud casing', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    writeGeneratedScheme(fixtureApp);
    const schemeDir = join(fixtureApp, 'ios', 'Solidarity.xcodeproj', 'xcshareddata', 'xcschemes');
    const workflowScheme = join(schemeDir, 'solidarity.xcscheme');
    createFakeToolchain(fakeBin, logPath);

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS: '0',
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    expect(readdirSync(schemeDir)).toContain('solidarity.xcscheme');
    expect(readdirSync(schemeDir)).not.toContain('Solidarity.xcscheme');
    expect(readOptional(workflowScheme)).toBe(generatedSchemeXml);
  });

  test('shared prepare script keeps an existing lowercase Xcode Cloud scheme', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const schemeDir = join(fixtureApp, 'ios', 'Solidarity.xcodeproj', 'xcshareddata', 'xcschemes');
    const workflowScheme = join(schemeDir, 'solidarity.xcscheme');
    // Pre-seed ONLY the workflow's lowercase scheme; the fake prebuild is told
    // NOT to write a scheme so this covers the no-op/keep path.
    mkdirSync(schemeDir, { recursive: true });
    writeFileSync(workflowScheme, generatedSchemeXml);
    createFakeToolchain(fakeBin, logPath);

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS: '0',
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        AIRMEISHI_FAKE_PREBUILD_NO_SCHEME: '1',
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    expect(readdirSync(schemeDir)).toContain('solidarity.xcscheme');
    expect(readdirSync(schemeDir)).not.toContain('Solidarity.xcscheme');
    expect(readOptional(workflowScheme)).toBe(generatedSchemeXml);
  });

  test('Xcode Cloud post-clone hook delegates to the same clean prepare flow', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const fixtureScriptsDir = join(fixtureApp, 'scripts');
    const fixtureCiScriptsDir = join(fixtureApp, 'ios', 'ci_scripts');
    mkdirSync(fixtureScriptsDir, { recursive: true });
    mkdirSync(fixtureCiScriptsDir, { recursive: true });
    writeFileSync(join(fixtureScriptsDir, 'prepare-ios-workspace.sh'), prepareScriptSource, {
      mode: 0o755,
    });
    writeFileSync(join(fixtureScriptsDir, 'stage-openac-srs.sh'), stageOpenAcSrsScriptSource, {
      mode: 0o755,
    });
    writeFileSync(join(fixtureScriptsDir, 'normalize-ios-scheme.sh'), normalizeSchemeScriptSource, {
      mode: 0o755,
    });
    createFakeToolchain(fakeBin, logPath);

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        cloudPostCloneScript,
        stdoutPath,
        stderrPath,
      ],
      cwd: fixtureCiScriptsDir,
      env: {
        ...process.env,
        CI_PRIMARY_REPOSITORY_PATH: fixtureRoot,
        COMMAND_LOG: logPath,
        AIRMEISHI_SETUP_IOS_NATIVE_BINDINGS: '0',
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    const commands = readCommandLog(logPath);
    expect(commands).toContain(`bun\t${fixtureRoot}\tinstall --frozen-lockfile`);
    expect(commands).toContain(
      `bunx\t${fixtureApp}\texpo prebuild --clean --platform ios --no-install`
    );
    expect(commands).toContain(`pod\t${join(fixtureApp, 'ios')}\tinstall`);
  }, 10_000);

  test('VisionCameraResizer packages a precompiled Metal library without compiling source', () => {
    expect(existsSync(precompiledResizerPluginPath), precompiledResizerPluginPath).toBe(true);
    expect(existsSync(precompiledResizerLibrary), precompiledResizerLibrary).toBe(true);
    if (!existsSync(precompiledResizerPluginPath) || !existsSync(precompiledResizerLibrary)) return;

    const fixtureApp = makeTempDir();
    const packageRoot = join(fixtureApp, 'node_modules', 'react-native-vision-camera-resizer');
    const metalDir = join(packageRoot, 'ios', 'Metal');
    const fixtureAssetDir = join(
      fixtureApp,
      'native-assets',
      'VisionCameraResizer'
    );
    mkdirSync(metalDir, { recursive: true });
    mkdirSync(fixtureAssetDir, { recursive: true });
    copyFileSync(
      join(
        repoRoot,
        'node_modules',
        'react-native-vision-camera-resizer',
        'ios',
        'Metal',
        'ResizerKernels.metal'
      ),
      join(metalDir, 'ResizerKernels.metal')
    );
    copyFileSync(precompiledResizerLibrary, join(fixtureAssetDir, 'default.metallib'));
    writeFileSync(
      join(packageRoot, 'VisionCameraResizer.podspec'),
      '"VisionCameraResizerShaders" => ["ios/Metal/ResizerKernels.metal"],\n'
    );
    const plugin = require(precompiledResizerPluginPath);

    plugin._internal.stagePrecompiledLibrary(fixtureApp, packageRoot);
    plugin._internal.stagePrecompiledLibrary(fixtureApp, packageRoot);

    const podspec = readFileSync(join(packageRoot, 'VisionCameraResizer.podspec'), 'utf8');
    expect(podspec).toContain('"ios/Metal/default.metallib"');
    expect(podspec).not.toContain('"ios/Metal/ResizerKernels.metal"');
    expect(readFileSync(join(metalDir, 'default.metallib'))).toEqual(
      readFileSync(precompiledResizerLibrary)
    );
    expect(appConfig.expo.plugins).toContain(
      './plugins/withPrecompiledVisionCameraResizerMetal.js'
    );
  });

  test('expo-modules-jsi patches: nested xcodebuild output cannot fail the xcframework phase', () => {
    expect(existsSync(jsiPatchesPluginPath), jsiPatchesPluginPath).toBe(true);
    if (!existsSync(jsiPatchesPluginPath)) return;

    const plugin = require(jsiPatchesPluginPath);
    const patch = plugin._internal.PATCHES.find(
      (p: { name: string }) => p.name === 'nested-xcodebuild-output'
    );
    const original = [
      '  log "Building framework slice for ${platform}..."',
      '',
      '  (cd "$PACKAGE_DIR" && env -i "${env_args[@]}" \\',
      '    xcodebuild \\',
      '    build \\',
      '    -quiet \\',
      '    SWIFT_COMPILATION_MODE=wholemodule \\',
      '  )',
      '',
      '  local product_path="${BUILD_PRODUCTS_PATH}/${build_dir_name}"',
      '',
    ].join('\n');

    const first = plugin._internal.patchSource(patch, original);
    expect(first.status).toBe('patched');
    expect(first.source).toContain('if ! (cd "$PACKAGE_DIR" && env -i "${env_args[@]}"');
    expect(first.source).toContain(') > "$nested_xcodebuild_log" 2>&1; then');
    expect(first.source).toContain('log "error: nested xcodebuild failed for ${platform}"');
    expect(first.source).toContain("sed -E 's/^((.*: )?)error: /\\1warning: /'");
    expect(plugin._internal.patchSource(patch, first.source).status).toBe('already-patched');

    // The rewritten block must still be valid bash, and the sed replay must turn
    // the spurious nested error line into a warning while leaving other lines alone.
    const fixtureDir = makeTempDir();
    const script = join(fixtureDir, 'patched.sh');
    writeFileSync(script, `#!/usr/bin/env bash\nset -euo pipefail\nlog() { echo "$1"; }\nbuild_slice() {\n  local platform="$1"\n${first.source}}\n`);
    expect(execFileSync('bash', ['-n', script]).toString()).toBe('');
    const nestedLog = join(fixtureDir, 'nested.log');
    writeFileSync(
      nestedLog,
      [
        'error: the following command failed with exit code 0 but produced no further output',
        'SwiftCompile normal arm64 (in target \'ExpoModulesJSI\' from project \'ExpoModulesJSI\')',
        '/x/JavaScriptRuntime.swift:70:27: warning: cannot infer ownership',
        '/x/Foo.swift:1:2: error: real diagnostic',
        '',
      ].join('\n')
    );
    // Under `bun test`, spawnSync/execFileSync report status 1 with empty output
    // for any child that writes to stdout (even `/bin/echo hi`), so the sed replay
    // is redirected to a file through the shell and asserted from disk.
    const replayLog = join(fixtureDir, 'replay.log');
    spawnSync('/bin/sh', [
      '-c',
      `/usr/bin/sed -E 's/^((.*: )?)error: /\\1warning: /' "$1" > "$2"`,
      'sh',
      nestedLog,
      replayLog,
    ]);
    const replay = readFileSync(replayLog, 'utf8');
    expect(replay).toBe(
      [
        'warning: the following command failed with exit code 0 but produced no further output',
        'SwiftCompile normal arm64 (in target \'ExpoModulesJSI\' from project \'ExpoModulesJSI\')',
        '/x/JavaScriptRuntime.swift:70:27: warning: cannot infer ownership',
        '/x/Foo.swift:1:2: warning: real diagnostic',
        '',
      ].join('\n')
    );
  });

  test('expo-modules-jsi patches apply to the installed package and are registered', () => {
    expect(existsSync(jsiPatchesPluginPath), jsiPatchesPluginPath).toBe(true);
    if (!existsSync(jsiPatchesPluginPath)) return;

    const plugin = require(jsiPatchesPluginPath);
    const packageRoot = join(repoRoot, 'node_modules', 'expo-modules-jsi');
    // Every patch must still find its anchor (or its marker) in the installed
    // package so an expo-modules-jsi upgrade fails here, not on Xcode Cloud.
    for (const patch of plugin._internal.PATCHES) {
      const installed = readFileSync(join(packageRoot, ...patch.file), 'utf8');
      expect(['patched', 'already-patched'], patch.name).toContain(
        plugin._internal.patchSource(patch, installed).status
      );
    }
    expect(appConfig.expo.plugins).toContain('./plugins/withExpoModulesJsiPatches.js');
  });

  test('shared prepare script stages native iOS binding xcframeworks before pod install', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const passportNoirDir = join(fixtureRoot, 'passport-noir');
    const localSrsDir = join(passportNoirDir, 'mopro-binding', 'test-vectors', 'srs');
    const passportAssetsDir = join(
      fixtureRoot,
      'nitro-modules',
      'attest',
      'android',
      'src',
      'main',
      'assets'
    );
    mkdirSync(join(fixtureApp, 'ios'), { recursive: true });
    mkdirSync(localSrsDir, { recursive: true });
    writeFileSync(join(localSrsDir, 'passport.srs.bin'), 'new merged local srs');
    mkdirSync(passportAssetsDir, { recursive: true });
    for (const staleSrs of [
      'dsc_chain.srs.bin',
      'passport_adapter.srs.bin',
      'openac_show.srs.bin',
    ]) {
      writeFileSync(join(passportAssetsDir, staleSrs), 'stale srs');
    }
    createFakeToolchain(fakeBin, logPath);
    writeNativeBindingDownloadStubs(fakeBin, logPath);

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_PASSPORT_MOPRO_SHA256: '',
        AIRMEISHI_PASSPORT_MOPRO_ZIP_URL: 'https://example.invalid/passport.zip',
        AIRMEISHI_PASSPORT_NOIR_DIR: passportNoirDir,
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        AIRMEISHI_SEMAPHORE_SWIFT_ZIP_URL: 'https://example.invalid/semaphore.zip',
        COMMAND_LOG: logPath,
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    expect(
      existsSync(
        join(
          passportNoirDir,
          'mopro-binding',
          'MoproiOSBindings',
          'MoproBindings.xcframework',
          'ios-arm64',
          'libpassport_zk_mopro.a'
        )
      )
    ).toBe(true);
    expect(
      existsSync(
        join(
          fixtureRoot,
          'nitro-modules',
          'attest',
          'semaphore',
          'mopro',
          'SemaphoreBindings.xcframework',
          'ios-arm64',
          'libsemaphore_bindings.a'
        )
      )
    ).toBe(true);
    expect(
      existsSync(join(passportAssetsDir, 'passport.srs.bin'))
    ).toBe(true);
    for (const staleSrs of [
      'dsc_chain.srs.bin',
      'passport_adapter.srs.bin',
      'openac_show.srs.bin',
    ]) {
      expect(existsSync(join(passportAssetsDir, staleSrs))).toBe(false);
    }

    const commands = readCommandLog(logPath);
    const downloads = commands.filter((line) => line.startsWith('curl\t'));
    expect(downloads).toHaveLength(2);
    expect(downloads.join('\n')).not.toContain('PassportOpenAcV3Srs.zip');
    expect(downloads.join('\n')).not.toContain('openac');
    const firstDownload = commands.findIndex((line) => line.startsWith('curl\t'));
    const podInstall = commands.findIndex((line) =>
      line === `pod\t${join(fixtureApp, 'ios')}\tinstall`
    );
    expect(firstDownload).toBeGreaterThan(-1);
    expect(podInstall).toBeGreaterThan(firstDownload);
  });

  test('prepare script downloads the pinned merged SRS when local artifacts are absent', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const passportNoirDir = join(fixtureRoot, 'passport-noir');
    const passportAssetsDir = join(
      fixtureRoot,
      'nitro-modules',
      'attest',
      'android',
      'src',
      'main',
      'assets'
    );
    mkdirSync(join(fixtureApp, 'ios'), { recursive: true });
    createFakeToolchain(fakeBin, logPath);
    writeNativeBindingDownloadStubs(fakeBin, logPath);

    const result = Bun.spawnSync({
      cmd: [
        '/bin/bash',
        '-c',
        '/bin/bash "$1" >"$2" 2>"$3"',
        'runner',
        prepareScript,
        stdoutPath,
        stderrPath,
      ],
      env: {
        ...process.env,
        AIRMEISHI_BUN_INSTALL_ARGS: '--frozen-lockfile',
        AIRMEISHI_EXPO_APP_DIR: fixtureApp,
        AIRMEISHI_INSTALL_TOOLING: '0',
        AIRMEISHI_PASSPORT_MOPRO_SHA256: '',
        AIRMEISHI_PASSPORT_MOPRO_ZIP_URL: 'https://example.invalid/passport.zip',
        AIRMEISHI_PASSPORT_NOIR_DIR: passportNoirDir,
        AIRMEISHI_PASSPORT_OPENAC_SRS_SHA256: '',
        AIRMEISHI_REPO_ROOT: fixtureRoot,
        AIRMEISHI_SEMAPHORE_SWIFT_ZIP_URL: 'https://example.invalid/semaphore.zip',
        COMMAND_LOG: logPath,
        PATH: `${fakeBin}:${process.env['PATH'] ?? ''}`,
      },
      stdout: 'ignore',
      stderr: 'ignore',
    });

    expect(
      result.exitCode,
      JSON.stringify({
        stderr: readOptional(stderrPath),
        stdout: readOptional(stdoutPath),
      })
    ).toBe(0);
    // Downloaded into the canonical local artifact path, then staged into the
    // pod assets dir by stage-openac-srs.sh exactly like a local build.
    expect(
      readFileSync(
        join(passportNoirDir, 'mopro-binding', 'test-vectors', 'srs', 'passport.srs.bin'),
        'utf8'
      )
    ).toBe('fake zip');
    expect(readFileSync(join(passportAssetsDir, 'passport.srs.bin'), 'utf8')).toBe(
      'fake zip'
    );
    const downloads = readCommandLog(logPath).filter((line) =>
      line.startsWith('curl\t')
    );
    expect(downloads).toHaveLength(3);
    expect(
      downloads.some(
        (line) =>
          line.includes('releases/download/') && line.includes('passport.srs.bin')
      )
    ).toBe(true);
  });
});
