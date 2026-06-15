import { describe, expect, it } from 'bun:test';
import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scenarioScript = new URL(
  './fixtures/secureMasterKeyScenario.ts',
  import.meta.url
).pathname;
const appRoot = new URL('../..', import.meta.url).pathname;

async function runScenario(name: string): Promise<void> {
  const resultPath = join(
    tmpdir(),
    `solidarity-secure-master-key-${name}-${Date.now()}-${Math.random()}.txt`
  );
  const proc = Bun.spawn({
    cmd: ['bun', scenarioScript, name],
    cwd: appRoot,
    env: {
      ...process.env,
      SECURE_MASTER_KEY_RESULT_PATH: resultPath,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const result = await Bun.file(resultPath).text().catch(() => '');
  await unlink(resultPath).catch(() => undefined);
  expect(stderr).toBe('');
  expect(exitCode).toBe(0);
  expect(stdout + result).toContain(`secureMasterKey:${name}:ok`);
}

describe('secureMasterKey', () => {
  it('recovers the raw Swift legacy master key before generating a fresh key', async () => {
    await runScenario('fresh-legacy');
  });

  it('repairs a previously-minted v2 key when the raw Swift legacy key is still present', async () => {
    await runScenario('repair-bad-v2');
  });
});
