import { afterEach, describe, expect, test } from 'bun:test';
import {
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
import { createRequire } from 'node:module';

const appDir = resolve(import.meta.dir, '../..');
const repoRoot = resolve(appDir, '../..');
const prepareScript = join(appDir, 'scripts', 'prepare-ios-workspace.sh');
const cloudPostCloneScript = join(appDir, 'ci-scripts', 'ci_post_clone.sh');
const require = createRequire(import.meta.url);
const disableClangExplicitModulesPlugin = require(
  join(appDir, 'plugins', 'withDisableClangExplicitModules.js')
);
const generatedSchemeXml = readFileSync(
  join(appDir, 'ios', 'Solidarity.xcodeproj', 'xcshareddata', 'xcschemes', 'solidarity.xcscheme'),
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
if [[ "$command_name" == "bunx" && "$*" == expo\\ prebuild* ]]; then
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
      `bunx\t${fixtureApp}\texpo prebuild --clean --platform ios --no-install`,
      `pod\t${join(fixtureApp, 'ios')}\tinstall`,
    ]);
  });

  test('shared prepare script exposes lowercase Xcode Cloud scheme alias', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    writeGeneratedScheme(fixtureApp);
    const schemeDir = join(fixtureApp, 'ios', 'Solidarity.xcodeproj', 'xcshareddata', 'xcschemes');
    const cloudScheme = join(schemeDir, 'solidarity.xcscheme');
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
    expect(readOptional(cloudScheme)).toBe(generatedSchemeXml);
  });

  test('Xcode Cloud post-clone hook delegates to the same clean prepare flow', () => {
    const fixtureRoot = makeTempDir();
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
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
      cwd: join(appDir, 'ios', 'ci_scripts'),
      env: {
        ...process.env,
        CI_PRIMARY_REPOSITORY_PATH: repoRoot,
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
    expect(commands).toContain(`bun\t${repoRoot}\tinstall --frozen-lockfile`);
    expect(commands).toContain(
      `bunx\t${appDir}\texpo prebuild --clean --platform ios --no-install`
    );
    expect(commands).toContain(`pod\t${join(appDir, 'ios')}\tinstall`);
  });

  test('shared prepare script stages native iOS binding xcframeworks before pod install', () => {
    const fixtureRoot = makeTempDir();
    const fixtureApp = join(fixtureRoot, 'apps', 'expo');
    const fakeBin = join(fixtureRoot, 'bin');
    const logPath = join(fixtureRoot, 'commands.log');
    const stdoutPath = join(fixtureRoot, 'stdout.log');
    const stderrPath = join(fixtureRoot, 'stderr.log');
    const passportNoirDir = join(fixtureRoot, 'passport-noir');
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
          'semaphore',
          'mopro',
          'SemaphoreBindings.xcframework',
          'ios-arm64',
          'libsemaphore_bindings.a'
        )
      )
    ).toBe(true);

    const commands = readCommandLog(logPath);
    const firstDownload = commands.findIndex((line) => line.startsWith('curl\t'));
    const podInstall = commands.findIndex((line) =>
      line === `pod\t${join(fixtureApp, 'ios')}\tinstall`
    );
    expect(firstDownload).toBeGreaterThan(-1);
    expect(podInstall).toBeGreaterThan(firstDownload);
  });
});
