/**
 * Onboarding state machine — mirrors Swift OnboardingFlowView.Step verbatim
 * (solidarity/Views/Onboarding/OnboardingFlowView.swift L5-13).
 *
 * Step list (Swift parity):
 *   1. welcome          — TerminalWelcomeScreen (typewriter intro)
 *   2. profileSetup     — DarkProfileSetupForm (name, link, X, LinkedIn, wallet)
 *   3. avatarSetup      — AvatarSelectionGrid (pick AnimalCharacter)
 *   4. secureKeys       — Generate DID + iCloud restore probe
 *   5. importContacts   — Phone picker / VCF import (skippable)
 *   6. scanPassport     — Open PassportOnboardingFlowView (skippable)
 *   7. complete         — `[ SYSTEM READY ]` summary + "Start Using Solidarity"
 *
 * Plain reducer (no zustand) so the flow stays unit-testable; promote to
 * a store only if cross-screen state grows beyond the wizard.
 */
import type { Animal } from '@solidarity/shared';

export const ONBOARDING_STEPS = [
  'welcome',
  'profileSetup',
  'avatarSetup',
  'secureKeys',
  'importContacts',
  'scanPassport',
  'complete',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingProfile {
  readonly username: string;
  readonly link: string;
  readonly xTwitter: string;
  readonly linkedIn: string;
  readonly wallet: string;
}

export interface OnboardingState {
  readonly step: OnboardingStep;
  readonly profile: OnboardingProfile;
  readonly animal: Animal | null;
  readonly keysGenerated: boolean;
  readonly importedCount: number | null;
  readonly passportScanned: boolean;
}

const EMPTY_PROFILE: OnboardingProfile = {
  username: '',
  link: '',
  xTwitter: '',
  linkedIn: '',
  wallet: '',
};

export const initialOnboardingState: OnboardingState = {
  step: 'welcome',
  profile: EMPTY_PROFILE,
  animal: null,
  keysGenerated: false,
  importedCount: null,
  passportScanned: false,
};

export type OnboardingAction =
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'goTo'; readonly step: OnboardingStep }
  | { readonly type: 'setProfile'; readonly profile: OnboardingProfile }
  | { readonly type: 'setProfileField'; readonly field: keyof OnboardingProfile; readonly value: string }
  | { readonly type: 'setAnimal'; readonly animal: Animal }
  | { readonly type: 'setKeysGenerated'; readonly value: boolean }
  | { readonly type: 'addImportedCount'; readonly count: number }
  | { readonly type: 'setPassportScanned'; readonly value: boolean };

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
    case 'setProfile':
      return { ...state, profile: action.profile };
    case 'setProfileField':
      return { ...state, profile: { ...state.profile, [action.field]: action.value } };
    case 'setAnimal':
      return { ...state, animal: action.animal };
    case 'setKeysGenerated':
      return { ...state, keysGenerated: action.value };
    case 'addImportedCount':
      return {
        ...state,
        importedCount: (state.importedCount ?? 0) + action.count,
      };
    case 'setPassportScanned':
      return { ...state, passportScanned: action.value };
  }
}
