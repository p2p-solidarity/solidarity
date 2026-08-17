/**
 * Pure consent-handler decision logic for the INCOMING (responder) side of
 * A5.2's full-card exchange — what `protocol.ts`'s `onCardRequest` handler
 * actually does once a `card.request` frame arrives. Kept out of
 * `consent.tsx` / `useCardExchange.ts` so the decision sequence itself is
 * unit-testable without React, React Native, or biometric/keychain modules
 * — same reasoning as `cardRequestState.ts`'s module doc.
 *
 * The sequence is fixed and MUST run in this order (tests pin the order via
 * call-count assertions, not just final output):
 *   1. `askConsent()` — show the sheet, wait for the user's Share/Decline
 *      tap. A `'decline'` short-circuits everything below — Face ID is
 *      never prompted for a request the user already said no to.
 *   2. `requireBiometric()` — ONLY reached after an explicit `'share'` tap.
 *      This is the CLAUDE.md "Face ID gates card release" requirement: the
 *      card JWS is already signed and sitting in the profile store, so
 *      biometrics here isn't gating a NEW signature — it's the consent gate
 *      for handing over material that's already signed. A denial declines,
 *      exactly like an explicit "no".
 *   3. `getCardJws()` — ONLY reached after both consent AND biometrics
 *      succeeded. Can legitimately return `null` (no profile saved yet on
 *      this device) — CLAUDE.md rule 8 (no fake data) means that's a
 *      decline too, never a fabricated placeholder card.
 *
 * Every failure path collapses to the same `{declined: true}` shape —
 * matching `protocol.ts`'s own documented policy that "no answer available"
 * and "consent denied" are deliberately wire-indistinguishable, so this
 * handler doesn't need (and must not invent) a way to tell the requester
 * WHY it was declined.
 */
import type { CardRequestHandler, CardRequestHandlerResult } from './protocol';

// Imported directly from the leaf module, NOT the `@/components/id` barrel —
// that barrel also re-exports several React Native components, which would
// pull `react-native`'s Flow-syntax entry point into this otherwise
// RN-free file and break a plain `bun test` import (same reasoning as
// `profile/store.ts`'s note on avoiding the `@/identity` barrel).
import { shortDid } from '@/components/id/shortDid';

export type ConsentDecision = 'share' | 'decline';

export interface CardReleaseDeps {
  /** Show the consent sheet for this incoming request and resolve once the
   *  user taps Share or Decline. */
  readonly askConsent: () => Promise<ConsentDecision>;
  /** Face-ID (or device-passcode-fallback) gate — see module doc step 2. */
  readonly requireBiometric: () => Promise<boolean>;
  /** The currently-saved full-card JWS, or `null` if none exists yet. */
  readonly getCardJws: () => string | null;
}

/** Compose `deps` into the `CardRequestHandler` shape `protocol.ts`'s
 *  `createPearSession(...).onCardRequest(...)` expects. */
export function makeCardRequestHandler(deps: CardReleaseDeps): CardRequestHandler {
  return async (): Promise<CardRequestHandlerResult> => {
    const decision = await deps.askConsent();
    if (decision === 'decline') return { declined: true };

    const allowed = await deps.requireBiometric();
    if (!allowed) return { declined: true };

    const cardJws = deps.getCardJws();
    if (cardJws === null) return { declined: true };

    return { cardJws };
  };
}

/**
 * What the consent sheet is allowed to show for "who is asking" (CLAUDE.md
 * honesty rule): a display name ONLY if the caller already verified it for
 * this exact did (e.g. a `VerifiedSnapshot.record.displayName` the
 * responder itself scanned/verified earlier) — never wire-supplied claim
 * data, since `protocol.ts`'s `CardRequestHandler` doesn't even receive
 * anything from the wire besides the fact that a request arrived. Falls
 * back to the short did whenever there's no verified name to show (`null`,
 * empty, or whitespace-only — a blank name is not more honest than the did
 * itself).
 */
export function formatPeerLabel(peerDid: string, verifiedDisplayName: string | null): string {
  const trimmed = verifiedDisplayName?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : shortDid(peerDid);
}
