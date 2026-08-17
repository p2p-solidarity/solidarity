/**
 * nostrBadgeDisplay.ts — pure mapping from `verifyNostrBinding`'s result
 * (`@solidarity/shared`) to a display-ready view model (04-plan Phase A4
 * task A4.4, "wire the badge row to real verification — the first real
 * green check").
 *
 * PURE — no React, no `react-native`, no `@/constants/Colors` (that module
 * pulls in `react-native`'s `Appearance`, which bun's test parser can't
 * load — same reasoning as `userKey.ts`'s lazy `expo-secure-store` import
 * and `profile/store.ts`'s doc on why it imports `rootKey.ts` directly
 * instead of the `@/identity` barrel). `ProfileBadgeChips.tsx` is the
 * only consumer and owns the icon/color/copy choices for each `visual`.
 *
 * ── The honesty contract this module enforces (01-spec §7 / 03-spec §3)──
 *
 * `declared` and `stale` must NEVER map to `'verified'` — including the
 * `revoked` `BadgeState`, which `verifyNostrBinding` cannot currently
 * return (it only ever resolves `verified`/`declared`/`stale`) but is
 * still handled defensively here so that if the shared verifier's state
 * machine ever grows a `revoked` case, this mapping fails closed to the
 * hollow `declared` visual rather than silently rendering a green check
 * for a revoked binding. See the test suite's "never verified for
 * declared/stale/revoked" pin.
 *
 * ── Loading vs. stale-while-revalidate (CLAUDE.md rule 10) ───────────────
 *
 * `loading` is ONLY shown when there is no prior result at all (`result ===
 * null`) — a cold first check. A background re-verify on tab focus (rule
 * 10: "no skeleton on warm") must keep rendering the last-known `result`
 * untouched while `isChecking` is `true`; this function ignores
 * `isChecking` whenever `result` is non-null, by design.
 */
import type { BadgeState, VerifyNostrBindingResult } from '@solidarity/shared';

/**
 * `hidden` — `npub === null`: profile makes no Nostr claim at all, so
 * there is nothing to render (not a badge, not a grey placeholder —
 * `badges/nostr.ts`'s module doc: gate on `npub`, never on `state`, for
 * "is there a badge at all").
 */
export type NostrBadgeVisual = 'hidden' | 'loading' | 'verified' | 'declared' | 'stale';

export interface NostrBadgeViewModel {
  readonly visual: NostrBadgeVisual;
  readonly npub: string | null;
  readonly pubkeyHex: string | null;
  readonly kind0CreatedAt: number | null;
  readonly direction1: boolean;
  readonly direction2: boolean | null;
}

const HIDDEN: NostrBadgeViewModel = {
  visual: 'hidden',
  npub: null,
  pubkeyHex: null,
  kind0CreatedAt: null,
  direction1: false,
  direction2: null,
};

const LOADING: NostrBadgeViewModel = { ...HIDDEN, visual: 'loading' };

/** Never returns `'verified'` for a `BadgeState` other than exactly `'verified'`. */
function visualForState(state: BadgeState): 'verified' | 'declared' | 'stale' {
  switch (state) {
    case 'verified':
      return 'verified';
    case 'stale':
      return 'stale';
    case 'declared':
      return 'declared';
    case 'revoked':
      // `verifyNostrBinding` cannot produce this today — defensive fallback
      // to the hollow/unconfirmed visual, never the green check. See module doc.
      return 'declared';
  }
}

/**
 * Truncate an `npub1…` string to a display-friendly `npub1abcd…wxyz` form.
 * Shared by `ProfileBadgeChips.tsx`'s evidence panel and `app/verify/nostr.tsx`'s
 * confirm-relays step so both surfaces render the same npub the same way.
 */
export function truncateNpub(npub: string): string {
  if (npub.length <= 20) return npub;
  return `${npub.slice(0, 12)}…${npub.slice(-6)}`;
}

/**
 * Map the last-known `verifyNostrBinding` result (or `null` if no check has
 * completed yet) + whether a check is currently in flight to a display-ready
 * view model. Never fabricates a state: `result === null && !isChecking` is
 * `'hidden'` (nothing known yet, nothing rendered) rather than a guess.
 */
export function nostrBadgeViewModel(
  result: VerifyNostrBindingResult | null,
  isChecking: boolean
): NostrBadgeViewModel {
  if (result === null) return isChecking ? LOADING : HIDDEN;
  if (result.npub === null) return HIDDEN;

  return {
    visual: visualForState(result.state),
    npub: result.npub,
    pubkeyHex: result.evidence.pubkeyHex,
    kind0CreatedAt: result.evidence.kind0CreatedAt,
    direction1: result.evidence.direction1,
    direction2: result.evidence.direction2,
  };
}
