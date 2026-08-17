/**
 * G3 decision-logic test — the recovery-failure "Enter recovery phrase" leg
 * (`resolvePhraseImportOutcome` in `src/onboarding/steps/backupStepLogic.ts`).
 *
 * This is the THIRD option offered when `restoreRootKeyFromICloud` fails (the
 * rootKey.ts contract: Retry / Enter Phrase / Start Fresh). The pure part
 * asserted here is the routing the component branches on:
 *   - empty / BIP-39-invalid phrase → `invalid` (inline field error, storage
 *     is never touched — a mistyped word must not read as a storage failure);
 *   - persist failure → `error` (the real typed error is surfaced);
 *   - persisted → `imported` (caller records `mnemonicOnly` + `onDone()`).
 *
 * Pure logic only — no React, no native modules; DI fakes stand in for
 * `deriveDidFromMnemonic` / `importFromMnemonic` (same style as
 * `backupStepLogic.test.ts` / `rootKey.test.ts`).
 */
import { describe, expect, it } from 'bun:test';

import type { Result } from '@solidarity/shared';
import type { RootKeyError } from '@/identity';

import { resolvePhraseImportOutcome } from '../../src/onboarding/steps/backupStepLogic';

function ok<T>(value: T): Result<T, RootKeyError> {
  return { ok: true, value };
}
function err<T>(error: RootKeyError): Result<T, RootKeyError> {
  return { ok: false, error };
}

const GOOD = 'did:key:zGood';
const VALID_PHRASE = Array.from({ length: 24 }, (_, i) => `word${String(i)}`).join(' ');

describe('resolvePhraseImportOutcome', () => {
  it('empty / whitespace phrase → invalid, never validates or persists', async () => {
    let derived = 0;
    let imported = 0;
    const deriveFn = () => {
      derived += 1;
      return ok(GOOD);
    };
    const importFn = async () => {
      imported += 1;
      return ok({ did: GOOD });
    };

    expect(await resolvePhraseImportOutcome('', deriveFn, importFn)).toEqual({ kind: 'invalid' });
    expect(await resolvePhraseImportOutcome('   ', deriveFn, importFn)).toEqual({ kind: 'invalid' });
    expect(derived).toBe(0);
    expect(imported).toBe(0);
  });

  it('BIP-39-invalid phrase → invalid, and storage is NEVER touched', async () => {
    let imported = 0;
    const deriveFn = (): Result<string, RootKeyError> => err({ kind: 'invalidMnemonic', message: 'bad checksum' });
    const importFn = async (): Promise<Result<{ readonly did: string }, RootKeyError>> => {
      imported += 1;
      return ok({ did: GOOD });
    };

    const outcome = await resolvePhraseImportOutcome('not a real phrase', deriveFn, importFn);

    expect(outcome).toEqual({ kind: 'invalid' });
    expect(imported).toBe(0);
  });

  it('valid phrase, import ok → imported with the derived did (caller: mnemonicOnly + onDone)', async () => {
    const deriveFn = () => ok(GOOD);
    const importFn = async () => ok({ did: GOOD });

    const outcome = await resolvePhraseImportOutcome(VALID_PHRASE, deriveFn, importFn);

    expect(outcome).toEqual({ kind: 'imported', did: GOOD });
  });

  it('valid phrase, persist fails → surfaces the real storage error, not a silent no-op', async () => {
    const deriveFn = () => ok(GOOD);
    const importFn = async (): Promise<Result<{ readonly did: string }, RootKeyError>> =>
      err({ kind: 'storageFailed', message: 'keychain write rejected' });

    const outcome = await resolvePhraseImportOutcome(VALID_PHRASE, deriveFn, importFn);

    expect(outcome).toEqual({
      kind: 'error',
      error: { kind: 'storageFailed', message: 'keychain write rejected' },
    });
  });

  it('trims surrounding whitespace before validating + persisting', async () => {
    const seen: { derive: string | null; import: string | null } = { derive: null, import: null };
    const deriveFn = (m: string) => {
      seen.derive = m;
      return ok(GOOD);
    };
    const importFn = async (m: string) => {
      seen.import = m;
      return ok({ did: GOOD });
    };

    await resolvePhraseImportOutcome(`\n  ${VALID_PHRASE}  \n`, deriveFn, importFn);

    expect(seen.derive).toBe(VALID_PHRASE);
    expect(seen.import).toBe(VALID_PHRASE);
  });
});
