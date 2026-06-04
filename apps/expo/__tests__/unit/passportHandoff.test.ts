/**
 * Passport → onboarding handoff signal tests. Pure pub/sub — no React, no
 * native modules.
 *
 * Guards the wiring that fixes the two onboarding bugs: after a passport
 * persist launched from onboarding, the wizard must hear a single completion
 * signal so it can set passportScanned and advance to `complete`. (Previously
 * nothing crossed the /passport route boundary, so the wizard stayed on the
 * scanPassport step with passportScanned stuck false.)
 */
import { describe, expect, it } from 'bun:test';

import {
  notifyPassportOnboardingCompleted,
  subscribePassportOnboardingCompleted,
} from '../../src/onboarding/passportHandoff';

describe('passportHandoff', () => {
  it('notifies an active subscriber', () => {
    let fired = 0;
    const unsubscribe = subscribePassportOnboardingCompleted(() => {
      fired += 1;
    });
    notifyPassportOnboardingCompleted();
    expect(fired).toBe(1);
    unsubscribe();
  });

  it('does not notify after unsubscribe (torn-down screen stays inert)', () => {
    let fired = 0;
    const unsubscribe = subscribePassportOnboardingCompleted(() => {
      fired += 1;
    });
    unsubscribe();
    notifyPassportOnboardingCompleted();
    expect(fired).toBe(0);
  });

  it('drops the signal when no one is listening (no buffering across remounts)', () => {
    // Must not throw and must not replay to a future subscriber.
    expect(() => { notifyPassportOnboardingCompleted(); }).not.toThrow();
    let fired = 0;
    const unsubscribe = subscribePassportOnboardingCompleted(() => {
      fired += 1;
    });
    expect(fired).toBe(0);
    unsubscribe();
  });
});
