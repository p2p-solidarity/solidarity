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

import type { RootKeyError } from '@/identity';

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
