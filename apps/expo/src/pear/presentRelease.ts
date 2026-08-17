/**
 * `src/pear/presentRelease.ts` — pure responder-side consent decision logic
 * for A5.3's SD-JWT presentation: what `protocol.ts`'s `onPresentRequest`
 * handler actually does once a `present.request` frame arrives. Mirrors
 * `cardRelease.ts`'s module doc almost verbatim — same reasoning, extended
 * with one extra up-front step: matching the requester's claim TYPES
 * against what this device can actually present BEFORE showing any UI.
 *
 * The sequence is fixed and MUST run in this order (tests pin the order via
 * call-count assertions, not just final output):
 *   1. `getMatchedClaims(claimTypes)` — SYNCHRONOUS, runs before any UI or
 *      biometric prompt. If this device holds nothing presentable that
 *      matches, decline immediately: no consent sheet, no Face ID, for a
 *      request this device could never fulfil anyway (CLAUDE.md rule 8 —
 *      never dress up "I have nothing to show you" as a decision the user
 *      had to make).
 *   2. `askConsent(matched)` — show the claim-selection sheet (selective
 *      disclosure — the point of SD-JWT), wait for the user's Share/Decline
 *      tap. A `'decline'`, OR a `'share'` with zero claims selected, is
 *      exactly `{declined: true}` — Face ID is never prompted for a request
 *      the user already effectively said no to.
 *   3. `requireBiometric()` — ONLY reached after an explicit share with at
 *      least one claim selected. Uses the SAME `'cardRelease'` reason
 *      `cardRelease.ts` uses (see that call site / `keychain/biometric.ts`'s
 *      doc): handing attested claims to a REMOTE peer is the same trust
 *      boundary as handing over the full card — a peer-scoped consent
 *      decision, not a same-device action like `sign`/`present`/`exchange`
 *      — so it gets the same always-fresh-prompt gate rather than riding a
 *      grace window armed by, say, the handshake's own signing call.
 *      (Decision recorded here per the task brief: reusing `'cardRelease'`
 *      instead of adding a new `'present'`-over-Pear reason.)
 *   4. `buildPresentation(selectedClaimIds)` — ONLY reached after both
 *      consent AND biometrics succeeded. Can fail (credential vanished
 *      between match and build, signing error, …) — collapses to
 *      `declined`, never a fabricated SD-JWT.
 *
 * Every failure path collapses to the same `{declined: true}` shape,
 * matching `protocol.ts`'s documented "no answer available and consent
 * denied are wire-indistinguishable" policy.
 */
import type { PresentableClaim } from './presentBuilder';
import type { PresentRequestHandler, PresentRequestHandlerResult } from './protocol';

export type PresentConsentDecision =
  | { readonly decision: 'share'; readonly selectedClaimIds: readonly string[] }
  | { readonly decision: 'decline' };

export type BuildPresentationResult =
  | { readonly ok: true; readonly sdJwt: string }
  | { readonly ok: false; readonly message: string };

export interface PresentReleaseDeps {
  /** Synchronous — no UI, no I/O. What this device could offer for these
   *  claim types RIGHT NOW (`presentBuilder.ts`'s `matchPresentableClaims`,
   *  bound to the current store snapshot by the caller). */
  readonly getMatchedClaims: (claimTypes: readonly string[]) => readonly PresentableClaim[];
  /** Show the claim-selection sheet for `matched` and resolve once the
   *  user taps Share (with a selection) or Decline. */
  readonly askConsent: (matched: readonly PresentableClaim[]) => Promise<PresentConsentDecision>;
  /** Face-ID (or device-passcode-fallback) gate — see module doc step 3. */
  readonly requireBiometric: () => Promise<boolean>;
  /** Build the actual SD-JWT (VP-wrapped) presentation for exactly the
   *  user-selected claim ids — never any claim outside that set. */
  readonly buildPresentation: (selectedClaimIds: readonly string[]) => Promise<BuildPresentationResult>;
}

/** Compose `deps` into the `PresentRequestHandler` shape `protocol.ts`'s
 *  `createPearSession(...).onPresentRequest(...)` expects. */
export function makePresentRequestHandler(deps: PresentReleaseDeps): PresentRequestHandler {
  return async (claims: readonly string[]): Promise<PresentRequestHandlerResult> => {
    const matched = deps.getMatchedClaims(claims);
    if (matched.length === 0) return { declined: true };

    const decision = await deps.askConsent(matched);
    if (decision.decision === 'decline') return { declined: true };
    if (decision.selectedClaimIds.length === 0) return { declined: true };

    const allowed = await deps.requireBiometric();
    if (!allowed) return { declined: true };

    const built = await deps.buildPresentation(decision.selectedClaimIds);
    if (!built.ok) return { declined: true };

    return { sdJwt: built.sdJwt };
  };
}
