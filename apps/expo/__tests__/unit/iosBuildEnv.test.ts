import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const appDir = resolve(import.meta.dir, '../..');
const repoRoot = resolve(appDir, '../..');
const prepareScript = join(appDir, 'scripts', 'prepare-ios-workspace.sh');
const cloudPostCloneScript = join(appDir, 'ci-scripts', 'ci_post_clone.sh');

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
printf '%s\\t%s\\t%s\\n' "$(basename "$0")" "$PWD" "$*" >> "${logPath}"
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

function readCommandLog(logPath: string): string[] {
  return readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
}

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('iOS build environment scripts', () => {
  test('test fixture paths resolve to the Expo app', () => {
    expect(existsSync(prepareScript), prepareScript).toBe(true);
    expect(existsSync(cloudPostCloneScript), cloudPostCloneScript).toBe(true);
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
});
