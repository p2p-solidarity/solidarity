/**
 * Onboarding state machine — 1.3.3 Task A2.5 converged the 7-step Swift-
 * parity wizard onto the Verified Page flow (US-01, docs/ref/02):
 *
 *   1. welcome     — TerminalWelcomeScreen (typewriter intro)
 *   2. secureKeys  — Generate DID + iCloud restore probe (Swift parity)
 *   3. backup      — [Phase A1 task A1.4] seed-derived root key backup
 *                     consent (iCloud vs. mnemonic ceremony). Non-skippable
 *                     — see app/onboarding steps/BackupStep.tsx.
 *   4. page        — [Phase A2 task A2.5] minimal Profile Record creation
 *                     (displayName + optional bio/link), signed + persisted
 *                     via `useProfileStore().saveProfile()`. Skippable with
 *                     honest "do it later from Me" copy — see
 *                     steps/PageStep.tsx.
 *   5. connect     — bind a real Bluesky or Nostr badge, or defer to Me.
 *   6. share       — [Phase A2 task A2.5] shows the just-created page's
 *                     link + QR (only if one exists) — see
 *                     steps/ShareStep.tsx.
 *   7. complete    — `[ SYSTEM READY ]` summary + "Start Using Solidarity".
 *
 * Dropped from the DEFAULT sequence (not in US-01's list):
 *   - profileSetup / avatarSetup — the old username+animal form that fed a
 *     legacy BusinessCard (`composeInitialCard` in app/onboarding/index.tsx,
 *     since removed). The Verified Page (`page`/`share` above) is now the
 *     "first thing you own"; a BusinessCard is still creatable manually via
 *     /cards/edit for anyone who wants the legacy card/QR-exchange surface,
 *     and `useMyCard()`'s consumers already render a real fallback when no
 *     card exists (see app/(tabs)/me/index.tsx's `card?.name ?? …`), so this
 *     is not a new unhandled state.
 *   - importContacts — still reachable from the People tab (`/contacts/
 *     import-phone`, `/contacts/import-vcf`), unrelated to identity setup.
 *   - scanPassport — still reachable from Settings/Me (`/passport`). The
 *     onboarding→/passport completion handoff (`passportHandoff.ts`) is now
 *     dormant (nothing passes `from=onboarding` anymore) but is left intact
 *     since `/passport` is a shared route outside this task's scope.
 *
 * `profile`/`animal`/`importedCount`/`passportScanned` are gone from this
 * state entirely — `page`/`connect`/`share`/`complete` read the Profile Record
 * straight from `useProfileStore` (the real source of truth, including on
 * REPLAY when a page already exists) instead of duplicating it into a
 * parallel reducer field that could desync (CLAUDE.md rule 8/9).
 *
 * Plain reducer (no zustand) so the flow stays unit-testable; promote to
 * a store only if cross-screen state grows beyond the wizard.
 */

import type { OnboardingBadgeProvider, OnboardingBadgeResult } from './badgeVerification';

export const ONBOARDING_STEPS = [
  'welcome',
  'secureKeys',
  'backup',
  'page',
  'connect',
  'share',
  'complete',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  readonly step: OnboardingStep;
  readonly keysGenerated: boolean;
  /** Navigation intent only; verifier evidence below remains authoritative. */
  readonly badgeProvider: OnboardingBadgeProvider | null;
  /** A real shared-verifier result retained warm for the terminal step. */
  readonly badgeResult: OnboardingBadgeResult | null;
}

export const initialOnboardingState: OnboardingState = {
  step: 'welcome',
  keysGenerated: false,
  badgeProvider: null,
  badgeResult: null,
};

export type OnboardingAction =
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'goTo'; readonly step: OnboardingStep }
  | { readonly type: 'setKeysGenerated'; readonly value: boolean }
  | { readonly type: 'setBadgeProvider'; readonly value: OnboardingBadgeProvider | null }
  | { readonly type: 'setBadgeResult'; readonly value: OnboardingBadgeResult | null };

function stepIndex(s: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(s);
}

function nextStep(s: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.min(stepIndex(s) + 1, ONBOARDING_STEPS.length - 1)] ?? 'complete';
}

function prevStep(s: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.max(stepIndex(s) - 1, 0)] ?? 'welcome';
}

export function onboardingReducer(
  state: OnboardingState,
  action: OnboardingAction
): OnboardingState {
  switch (action.type) {
    case 'next':
      return { ...state, step: nextStep(state.step) };
    case 'back':
      return { ...state, step: prevStep(state.step) };
    case 'goTo':
      return { ...state, step: action.step };
    case 'setKeysGenerated':
      return { ...state, keysGenerated: action.value };
    case 'setBadgeProvider':
      return { ...state, badgeProvider: action.value };
    case 'setBadgeResult':
      return { ...state, badgeResult: action.value };
  }
}
