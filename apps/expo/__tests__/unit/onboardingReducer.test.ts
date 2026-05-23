/**
 * Onboarding state-machine tests. Pure reducer — no React, no native modules.
 */
import { describe, expect, it } from 'bun:test';

import {
  initialOnboardingState,
  ONBOARDING_STEPS,
  onboardingReducer,
} from '../../src/onboarding/state';

describe('onboardingReducer', () => {
  it('starts at terminalWelcome', () => {
    expect(initialOnboardingState.step).toBe('terminalWelcome');
  });

  it('advances through all 7 steps in order', () => {
    let s = initialOnboardingState;
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      s = onboardingReducer(s, { type: 'next' });
      expect(s.step).toBe(ONBOARDING_STEPS[i] ?? 'done');
    }
  });

  it('back is a no-op on the first step', () => {
    const s = onboardingReducer(initialOnboardingState, { type: 'back' });
    expect(s.step).toBe('terminalWelcome');
  });

  it('next is a no-op on the last step', () => {
    let s = initialOnboardingState;
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      s = onboardingReducer(s, { type: 'next' });
    }
    const stuck = onboardingReducer(s, { type: 'next' });
    expect(stuck.step).toBe('done');
  });

  it('stores profile + animal + backup choice', () => {
    let s = initialOnboardingState;
    s = onboardingReducer(s, { type: 'setProfile', name: 'Ada', handle: 'ada' });
    s = onboardingReducer(s, { type: 'setAnimal', animal: 'sheep' });
    s = onboardingReducer(s, { type: 'setBackupChoice', choice: 'icloud' });
    s = onboardingReducer(s, { type: 'setFaceId', enabled: true });
    expect(s.profile.name).toBe('Ada');
    expect(s.animal).toBe('sheep');
    expect(s.backupChoice).toBe('icloud');
    expect(s.faceIdEnabled).toBe(true);
  });

  it('accumulates granted permissions', () => {
    let s = initialOnboardingState;
    s = onboardingReducer(s, { type: 'grantPermission', permission: 'camera' });
    s = onboardingReducer(s, { type: 'grantPermission', permission: 'contacts' });
    expect(s.grantedPermissions.has('camera')).toBe(true);
    expect(s.grantedPermissions.has('contacts')).toBe(true);
    expect(s.grantedPermissions.has('notifications')).toBe(false);
  });
});
