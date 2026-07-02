/**
 * Onboarding state-machine tests. Pure reducer — no React, no native modules.
 *
 * Mirrors Swift OnboardingFlowView.Step (welcome → profileSetup →
 * avatarSetup → secureKeys → importContacts → scanPassport → complete),
 * plus the Expo-only `backup` step (04-plan Phase A1 task A1.4, inserted
 * after `secureKeys`) — see src/onboarding/state.ts.
 */
import { describe, expect, it } from 'bun:test';

import {
  initialOnboardingState,
  ONBOARDING_STEPS,
  onboardingReducer,
} from '../../src/onboarding/state';

describe('onboardingReducer', () => {
  it('starts at welcome', () => {
    expect(initialOnboardingState.step).toBe('welcome');
  });

  it('advances through every step in order', () => {
    let s = initialOnboardingState;
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      s = onboardingReducer(s, { type: 'next' });
      expect(s.step).toBe(ONBOARDING_STEPS[i] ?? 'complete');
    }
  });

  it('back is a no-op on the first step', () => {
    const s = onboardingReducer(initialOnboardingState, { type: 'back' });
    expect(s.step).toBe('welcome');
  });

  it('next is a no-op on the last step', () => {
    let s = initialOnboardingState;
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      s = onboardingReducer(s, { type: 'next' });
    }
    const stuck = onboardingReducer(s, { type: 'next' });
    expect(stuck.step).toBe('complete');
  });

  it('goTo jumps to an arbitrary step', () => {
    const s = onboardingReducer(initialOnboardingState, { type: 'goTo', step: 'scanPassport' });
    expect(s.step).toBe('scanPassport');
  });

  it('stores profile + animal + key + passport state', () => {
    let s = initialOnboardingState;
    s = onboardingReducer(s, {
      type: 'setProfile',
      profile: {
        username: 'Ada',
        link: 'https://ada.dev',
        xTwitter: 'ada',
        linkedIn: 'ada',
        wallet: '0xABCD',
      },
    });
    s = onboardingReducer(s, { type: 'setAnimal', animal: 'sheep' });
    s = onboardingReducer(s, { type: 'setKeysGenerated', value: true });
    s = onboardingReducer(s, { type: 'setPassportScanned', value: true });
    expect(s.profile.username).toBe('Ada');
    expect(s.profile.wallet).toBe('0xABCD');
    expect(s.animal).toBe('sheep');
    expect(s.keysGenerated).toBe(true);
    expect(s.passportScanned).toBe(true);
  });

  it('setProfileField updates a single field', () => {
    let s = initialOnboardingState;
    s = onboardingReducer(s, { type: 'setProfileField', field: 'username', value: 'Lovelace' });
    expect(s.profile.username).toBe('Lovelace');
    expect(s.profile.link).toBe('');
  });

  it('sets imported contacts count to the latest total (does not accumulate)', () => {
    let s = initialOnboardingState;
    s = onboardingReducer(s, { type: 'setImportedCount', count: 5 });
    expect(s.importedCount).toBe(5);
    // ImportContactsStep feeds the manifest TOTAL on every render; the reducer
    // must REPLACE, not add. Re-reporting the same total must be idempotent —
    // otherwise the effect runs away to thousands (the 23082-contacts bug).
    s = onboardingReducer(s, { type: 'setImportedCount', count: 5 });
    expect(s.importedCount).toBe(5);
    s = onboardingReducer(s, { type: 'setImportedCount', count: 8 });
    expect(s.importedCount).toBe(8);
  });
});
