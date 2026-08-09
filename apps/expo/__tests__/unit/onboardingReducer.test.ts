/**
 * Onboarding state-machine tests. Pure reducer — no React, no native modules.
 *
 * v2 uses the exact five-dot product sequence from v2.html:
 * welcome → username → passkey → links → complete.
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

  it('the default sequence is exactly welcome → username → passkey → links → complete', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'welcome',
      'username',
      'passkey',
      'links',
      'complete',
    ]);
  });

  it('drops every technical or legacy step from the product sequence', () => {
    for (const legacy of [
      'secureKeys',
      'backup',
      'page',
      'connect',
      'share',
      'profileSetup',
      'avatarSetup',
      'importContacts',
      'scanPassport',
    ]) {
      expect(ONBOARDING_STEPS).not.toContain(legacy);
    }
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

  it('back retreats one step at a time (e.g. links → passkey → username)', () => {
    let s = onboardingReducer(initialOnboardingState, { type: 'goTo', step: 'links' });
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe('passkey');
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe('username');
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
    const s = onboardingReducer(initialOnboardingState, { type: 'goTo', step: 'links' });
    expect(s.step).toBe('links');
  });

  it('tracks keysGenerated', () => {
    expect(initialOnboardingState.keysGenerated).toBe(false);
    const s = onboardingReducer(initialOnboardingState, { type: 'setKeysGenerated', value: true });
    expect(s.keysGenerated).toBe(true);
  });

});
