/**
 * One-shot handoff from the shared `/passport` route back into the onboarding
 * flow — a faithful port of Swift `PassportOnboardingFlowView(onCompleted:)`
 * (OnboardingFlowView.swift). iOS presents the passport pipeline as a
 * `.fullScreenCover` and, on "Save Passport Credential", runs a completion
 * closure that sets `passportScanned = true` and advances to `.complete`.
 *
 * The Expo port reuses `/passport` as a standalone route shared by Settings
 * and the Me page, so there is no parent closure to invoke. This module carries
 * that single signal across the route boundary: `/passport` fires it on a
 * successful persist *only when launched from onboarding* (`from=onboarding`),
 * and the onboarding screen subscribes for as long as the wizard is mounted.
 *
 * It is a transient event, not state — deliberately not a zustand store. The
 * listener runs synchronously, before `/passport` calls `router.back()`, so the
 * onboarding screen has already moved to the `complete` step by the time it is
 * revealed. No buffering: the onboarding screen is always mounted (it pushed
 * `/passport`), so a subscriber is guaranteed present when the signal fires.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Fired by `/passport` after a successful onboarding-launched persist. */
export function notifyPassportOnboardingCompleted(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Subscribe while the onboarding wizard is mounted. Returns an unsubscribe to
 * call on unmount so a torn-down screen never reacts to a later signal.
 */
export function subscribePassportOnboardingCompleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
