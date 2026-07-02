/**
 * Regression test for the BackupStep "decline to mnemonic" dead-button bug
 * on replay (`hasRootKey()` true at mount → `mnemonicWords` never populated
 * by the provisioning effect, so choosing the phrase path used to silently
 * do nothing). See `src/onboarding/steps/backupStepLogic.ts` module doc.
 *
 * Pure logic only — no React, no native modules, same DI-fake style as
 * `rootKey.test.ts` (`revealFn` stands in for `revealMnemonicForExport`).
 */
import { describe, expect, it } from 'bun:test';

import type { Result } from '@solidarity/shared';
import type { RootKeyError } from '@/identity';

import { resolveMnemonicForCeremony } from '../../src/onboarding/steps/backupStepLogic';

function ok<T>(value: T): Result<T, RootKeyError> {
  return { ok: true, value };
}
function err(error: RootKeyError): Result<string, RootKeyError> {
  return { ok: false, error };
}

describe('resolveMnemonicForCeremony', () => {
  it('reuses already-known words (fresh provisioning) without calling revealFn', async () => {
    const words = ['alpha', 'bravo', 'charlie'];
    let calls = 0;
    const revealFn = async () => {
      calls += 1;
      return ok('should not be called');
    };

    const outcome = await resolveMnemonicForCeremony(words, revealFn);

    expect(outcome).toEqual({ kind: 'ready', words });
    expect(calls).toBe(0);
  });

  it('replay (empty words): reveals the existing mnemonic via revealFn instead of a dead no-op', async () => {
    const mnemonic = Array.from({ length: 24 }, (_, i) => `word${String(i)}`).join(' ');
    const revealFn = async () => ok(mnemonic);

    const outcome = await resolveMnemonicForCeremony([], revealFn);

    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.words).toEqual(mnemonic.split(' '));
      expect(outcome.words.length).toBe(24);
    }
  });

  it('replay + Face ID gate denial: surfaces a real error, not a silent no-op', async () => {
    const revealFn = async (): Promise<Result<string, RootKeyError>> => err({ kind: 'biometricDenied' });

    const outcome = await resolveMnemonicForCeremony([], revealFn);

    expect(outcome).toEqual({ kind: 'error', error: { kind: 'biometricDenied' } });
  });

  it('replay + storage failure: surfaces the storage error', async () => {
    const revealFn = async (): Promise<Result<string, RootKeyError>> =>
      err({ kind: 'storageFailed', message: 'disk full' });

    const outcome = await resolveMnemonicForCeremony([], revealFn);

    expect(outcome).toEqual({
      kind: 'error',
      error: { kind: 'storageFailed', message: 'disk full' },
    });
  });
});
