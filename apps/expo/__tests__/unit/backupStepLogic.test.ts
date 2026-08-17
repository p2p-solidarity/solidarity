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

import {
  resolveIcloudAcceptOutcome,
  resolveMnemonicForCeremony,
  resolveRecoveryDecision,
} from '../../src/onboarding/steps/backupStepLogic';

function ok<T>(value: T): Result<T, RootKeyError> {
  return { ok: true, value };
}
function err<T>(error: RootKeyError): Result<T, RootKeyError> {
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

/**
 * Regression target: `BackupStep.tsx`'s `acceptICloud` must gate
 * `setPref('rootKeySyncChoice', 'icloud')` (and `onDone()`) on the
 * synchronizable-item write actually resolving `ok(...)` — never on tap
 * alone (CLAUDE.md rule 8, no fake data; the exact bug task A1.5 exists to
 * fix). `resolveIcloudAcceptOutcome` is the pure decision `acceptICloud`
 * branches on, so asserting its outcome here is equivalent to asserting the
 * gating: the component only reaches the choice-recording branch on
 * `'success'`, and only reaches the showError + mnemonic-ceremony-fallback
 * branch on `'error'`.
 */
describe('resolveIcloudAcceptOutcome', () => {
  it('write ok: resolves success — caller records the choice and advances', async () => {
    const enableFn = async (): Promise<Result<void, RootKeyError>> => ok(undefined);

    const outcome = await resolveIcloudAcceptOutcome(enableFn);

    expect(outcome).toEqual({ kind: 'success' });
  });

  it('write err: resolves error — caller must NOT record the choice, shows the real error, and falls back to the mnemonic ceremony', async () => {
    const enableFn = async (): Promise<Result<void, RootKeyError>> =>
      err({ kind: 'storageFailed', message: 'icloud keychain write rejected' });

    const outcome = await resolveIcloudAcceptOutcome(enableFn);

    expect(outcome).toEqual({
      kind: 'error',
      error: { kind: 'storageFailed', message: 'icloud keychain write rejected' },
    });
  });
});

describe('resolveRecoveryDecision', () => {
  it('recovered / already-local identity short-circuits to recovered with the did', () => {
    expect(
      resolveRecoveryDecision(ok({ kind: 'restoredFromICloud', did: 'did:key:zRestored' }))
    ).toEqual({ kind: 'recovered', did: 'did:key:zRestored' });
    expect(
      resolveRecoveryDecision(ok({ kind: 'alreadyLocal', did: 'did:key:zLocal' }))
    ).toEqual({ kind: 'recovered', did: 'did:key:zLocal' });
  });

  it('authoritative notFound (read worked, nothing synced) is the ONLY path that mints without asking', () => {
    expect(resolveRecoveryDecision(ok({ kind: 'notFound' }))).toEqual({ kind: 'mintFresh' });
  });

  it('a failed or corrupt cloud read routes to askUser — never a silent fresh mint', () => {
    const storage = { kind: 'storageFailed', message: 'keychain unavailable' } as const;
    expect(resolveRecoveryDecision(err(storage))).toEqual({ kind: 'askUser', error: storage });

    const corrupt = { kind: 'invalidMnemonic', message: 'bad checksum' } as const;
    expect(resolveRecoveryDecision(err(corrupt))).toEqual({ kind: 'askUser', error: corrupt });
  });
});
