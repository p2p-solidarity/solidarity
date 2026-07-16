/**
 * Onboarding state-machine tests. Pure reducer — no React, no native modules.
 *
 * 1.3.3 Task A2.5 converged the onboarding flow onto the Verified Page
 * story (US-01): welcome → secureKeys → backup → page → connect → share → complete.
 * The legacy Swift-parity steps (profileSetup/avatarSetup — a name+animal
 * form that fed a now-superseded BusinessCard — plus importContacts and
 * scanPassport) were dropped from the DEFAULT sequence; those features stay
 * reachable from their normal surfaces (People tab import, Settings/Me →
 * /passport) — see src/onboarding/state.ts's module doc.
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

  it('the default sequence is exactly welcome → secureKeys → backup → page → connect → share → complete', () => {
    expect(ONBOARDING_STEPS).toEqual([
      'welcome',
      'secureKeys',
      'backup',
      'page',
      'connect',
      'share',
      'complete',
    ]);
  });

  it('drops every legacy step not in the US-01 sequence', () => {
    for (const legacy of ['profileSetup', 'avatarSetup', 'importContacts', 'scanPassport']) {
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

  it('back retreats one step at a time (e.g. share → connect → page)', () => {
    let s = onboardingReducer(initialOnboardingState, { type: 'goTo', step: 'share' });
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe('connect');
    s = onboardingReducer(s, { type: 'back' });
    expect(s.step).toBe('page');
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
    const s = onboardingReducer(initialOnboardingState, { type: 'goTo', step: 'page' });
    expect(s.step).toBe('page');
  });

  it('tracks keysGenerated', () => {
    expect(initialOnboardingState.keysGenerated).toBe(false);
    const s = onboardingReducer(initialOnboardingState, { type: 'setKeysGenerated', value: true });
    expect(s.keysGenerated).toBe(true);
  });

  it('threads the chosen provider and real verifier result without reducing it to a boolean', () => {
    const selected = onboardingReducer(initialOnboardingState, {
      type: 'setBadgeProvider',
      value: 'bluesky',
    });
    expect(selected.badgeProvider).toBe('bluesky');

    const verification = {
      provider: 'bluesky' as const,
      result: {
        state: 'declared' as const,
        handle: 'alice.bsky.social',
        evidence: {
          handleClaim: 'alice.bsky.social',
          repoDid: 'did:plc:alice',
          recordUri: null,
          direction1: true,
          direction2: false,
          reason: 'one-way',
        },
      },
    };
    const checked = onboardingReducer(selected, { type: 'setBadgeResult', value: verification });

    expect(checked.badgeResult).toEqual(verification);
    expect(checked.badgeResult?.result.state).toBe('declared');
  });
});
