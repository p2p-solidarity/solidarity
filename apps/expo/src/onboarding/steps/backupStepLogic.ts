/**
 * BackupStep — pure decision logic, split out of the component so the
 * "decline to mnemonic" ceremony can be unit-tested without rendering React
 * Native (mirrors `src/onboarding/state.ts`'s reducer-extraction pattern).
 *
 * Regression target: on REPLAY (Settings › Replay Onboarding, or any mount
 * where `hasRootKey()` was already true), `BackupStep`'s provisioning effect
 * intentionally does NOT mint a new mnemonic — it would silently rotate an
 * existing identity. That means `mnemonicWords` starts empty, so a naive
 * "words.length === 0 → return" guard on the mnemonic button turned it into
 * a dead button (the finding this file fixes). Instead: reuse the words if
 * already known (fresh-provisioning path), otherwise reveal the EXISTING
 * mnemonic through the same Face-ID-gated `revealMnemonicForExport` the
 * export settings screen uses, and surface a real error (never a silent
 * no-op) if that gate fails.
 */
import type { Result } from '@solidarity/shared';

import type { RootKeyError, RootKeyRecovery } from '@/identity';

export type MnemonicCeremonyOutcome =
  | { readonly kind: 'ready'; readonly words: readonly string[] }
  | { readonly kind: 'error'; readonly error: RootKeyError };

/**
 * Resolve the words to show for the mnemonic backup ceremony.
 *
 * - `currentWords` non-empty (fresh provisioning already returned the
 *   plaintext mnemonic): reused as-is, `revealFn` is never called — no
 *   extra IO or Face ID prompt for the common onboarding path.
 * - `currentWords` empty (replay/has-key state): calls `revealFn`
 *   (`revealMnemonicForExport`) to fetch the existing mnemonic behind the
 *   Face ID gate.
 */
export async function resolveMnemonicForCeremony(
  currentWords: readonly string[],
  revealFn: () => Promise<Result<string, RootKeyError>>
): Promise<MnemonicCeremonyOutcome> {
  if (currentWords.length > 0) return { kind: 'ready', words: currentWords };
  const revealed = await revealFn();
  if (!revealed.ok) return { kind: 'error', error: revealed.error };
  return { kind: 'ready', words: revealed.value.split(' ') };
}

export type IcloudAcceptOutcome =
  | { readonly kind: 'success' }
  | { readonly kind: 'error'; readonly error: RootKeyError };

/**
 * Resolve the outcome of accepting the "Use iCloud Keychain" option: calls
 * `enableFn` (`enableICloudBackup`) and reports whether the write actually
 * succeeded. Pure decision only — `BackupStep.tsx`'s `acceptICloud` owns the
 * side effects gated on this outcome: on `'success'`, record
 * `rootKeySyncChoice = 'icloud'` and advance (`onDone()`); on `'error'`, show
 * the real error and fall back to the mnemonic ceremony
 * (`declineToMnemonic`). `rootKeySyncChoice` must NEVER be set before this
 * resolves `'success'` — CLAUDE.md rule 8 (no fake data), and the exact bug
 * task A1.5 exists to fix (see `rootKey.ts`'s module doc).
 */
export async function resolveIcloudAcceptOutcome(
  enableFn: () => Promise<Result<void, RootKeyError>>
): Promise<IcloudAcceptOutcome> {
  const result = await enableFn();
  if (!result.ok) return { kind: 'error', error: result.error };
  return { kind: 'success' };
}

export type PhraseImportOutcome =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'imported'; readonly did: string }
  | { readonly kind: 'error'; readonly error: RootKeyError };

/**
 * Resolve the recovery-failure "Enter recovery phrase" leg (the THIRD option
 * offered when `restoreRootKeyFromICloud` fails — see `rootKey.ts`'s
 * `restoreRootKeyFromICloud` doc: callers offer Retry / Enter Phrase / Start
 * Fresh). Reuses the EXISTING derivation + import path (`deriveDidFromMnemonic`
 * + `importFromMnemonic`) rather than reimplementing any crypto:
 *
 * - empty / BIP-39-invalid phrase → `invalid` (caller shows an inline field
 *   error — a mistyped word must never be mistaken for a storage failure);
 * - import (persist) failure → `error` (caller surfaces the real typed error);
 * - persisted → `imported` (caller records `rootKeySyncChoice='mnemonicOnly'`
 *   — the user holds the phrase outside iCloud — and advances via `onDone()`,
 *   the same terminal effect as the `recovered` path).
 *
 * Pure decision only: never logs, persists, or returns the plaintext phrase
 * beyond handing it to the injected functions (the same functions the export
 * settings screen uses, which keep it on the existing keychain path).
 */
export async function resolvePhraseImportOutcome(
  phrase: string,
  deriveFn: (mnemonic: string) => Result<string, RootKeyError>,
  importFn: (mnemonic: string) => Promise<Result<{ readonly did: string }, RootKeyError>>
): Promise<PhraseImportOutcome> {
  const trimmed = phrase.trim();
  if (trimmed.length === 0) return { kind: 'invalid' };
  // Validate BEFORE persisting so a bad phrase never reaches storage and is
  // reported as a field error, not an import failure.
  const derived = deriveFn(trimmed);
  if (!derived.ok) return { kind: 'invalid' };
  const imported = await importFn(trimmed);
  if (!imported.ok) return { kind: 'error', error: imported.error };
  return { kind: 'imported', did: imported.value.did };
}

/** What BackupStep's provisioning effect must do with a recovery attempt. */
export type RootKeyRecoveryDecision =
  | { readonly kind: 'recovered'; readonly did: string }
  | { readonly kind: 'mintFresh' }
  | { readonly kind: 'askUser'; readonly error: RootKeyError };

/**
 * Route `restoreRootKeyFromICloud()`'s outcome. The security-relevant leg is
 * the error one: a failed or corrupt cloud read maps to `askUser` — NEVER to
 * `mintFresh` — because "absence/badness of a cloud key is not proof the user
 * is new" (04-plan invariant). Only an authoritative `notFound` (the read
 * worked and no synced phrase exists) may mint without asking; on `askUser`
 * the component offers retry vs an EXPLICIT create-new-identity choice.
 */
export function resolveRecoveryDecision(
  recovery: Result<RootKeyRecovery, RootKeyError>
): RootKeyRecoveryDecision {
  if (!recovery.ok) return { kind: 'askUser', error: recovery.error };
  if (recovery.value.kind === 'notFound') return { kind: 'mintFresh' };
  return { kind: 'recovered', did: recovery.value.did };
}
