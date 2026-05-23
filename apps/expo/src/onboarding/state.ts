/**
 * Onboarding state machine — mirrors Swift OnboardingFlowView (7 steps).
 *
 * Steps (Swift parity):
 *   1. terminalWelcome   — typewriter intro
 *   2. profileSetup      — name + handle
 *   3. avatarSelection   — pick AnimalCharacter
 *   4. permissions       — camera / contacts / notifications
 *   5. backupChoice      — iCloud (iOS) / Drive (Android) / Skip
 *   6. faceIdOptIn       — enable biometric gating for sensitive ops
 *   7. done              — handoff to MainTabView
 *
 * The state is intentionally a plain reducer (no Zustand for now) so the
 * onboarding flow is straightforward to unit-test. Promotes to a store
 * only if cross-screen state grows beyond the wizard.
 */
import type { Animal } from '@solidarity/shared';

export const ONBOARDING_STEPS = [
  'terminalWelcome',
  'profileSetup',
  'avatarSelection',
  'permissions',
  'backupChoice',
  'faceIdOptIn',
  'done',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingState {
  readonly step: OnboardingStep;
  readonly profile: {
    readonly name: string;
    readonly handle: string;
  };
  readonly animal: Animal | null;
  readonly grantedPermissions: ReadonlySet<'camera' | 'contacts' | 'notifications'>;
  readonly backupChoice: 'icloud' | 'drive' | 'skip' | null;
  readonly faceIdEnabled: boolean;
}

export const initialOnboardingState: OnboardingState = {
  step: 'terminalWelcome',
  profile: { name: '', handle: '' },
  animal: null,
  grantedPermissions: new Set(),
  backupChoice: null,
  faceIdEnabled: false,
};

export type OnboardingAction =
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  | { readonly type: 'setProfile'; readonly name: string; readonly handle: string }
  | { readonly type: 'setAnimal'; readonly animal: Animal }
  | {
      readonly type: 'grantPermission';
      readonly permission: 'camera' | 'contacts' | 'notifications';
    }
  | { readonly type: 'setBackupChoice'; readonly choice: 'icloud' | 'drive' | 'skip' }
  | { readonly type: 'setFaceId'; readonly enabled: boolean };

function stepIndex(s: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(s);
}

function nextStep(s: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.min(stepIndex(s) + 1, ONBOARDING_STEPS.length - 1)] ?? 'done';
}

function prevStep(s: OnboardingStep): OnboardingStep {
  return ONBOARDING_STEPS[Math.max(stepIndex(s) - 1, 0)] ?? 'terminalWelcome';
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
    case 'setProfile':
      return { ...state, profile: { name: action.name, handle: action.handle } };
    case 'setAnimal':
      return { ...state, animal: action.animal };
    case 'grantPermission':
      return {
        ...state,
        grantedPermissions: new Set([...state.grantedPermissions, action.permission]),
      };
    case 'setBackupChoice':
      return { ...state, backupChoice: action.choice };
    case 'setFaceId':
      return { ...state, faceIdEnabled: action.enabled };
  }
}
