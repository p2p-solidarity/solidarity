/**
 * Pure display mapping for the shared bidirectional ATProto verifier.
 * A warm result always wins over `isChecking`, so focus revalidation never
 * replaces honest evidence with a spinner. `revoked` fails closed to the
 * unverified/declared visual; only exactly `verified` can earn a filled seal.
 */
import type { BadgeState, VerifyAtprotoBindingResult } from '@solidarity/shared';

export type AtprotoBadgeVisual = 'hidden' | 'loading' | 'verified' | 'declared' | 'stale';

export interface AtprotoBadgeViewModel {
  readonly visual: AtprotoBadgeVisual;
  readonly handle: string | null;
  readonly repoDid: string | null;
  readonly recordUri: string | null;
  readonly direction1: boolean;
  readonly direction2: boolean | null;
}

const EMPTY_EVIDENCE = {
  handle: null,
  repoDid: null,
  recordUri: null,
  direction1: false,
  direction2: null,
} as const;

function visualForState(
  state: BadgeState
): Extract<AtprotoBadgeVisual, 'verified' | 'declared' | 'stale'> {
  switch (state) {
    case 'verified':
      return 'verified';
    case 'stale':
      return 'stale';
    case 'declared':
    case 'revoked':
      return 'declared';
  }
}

export function atprotoBadgeViewModel(
  result: VerifyAtprotoBindingResult | null,
  isChecking: boolean
): AtprotoBadgeViewModel {
  if (result === null) {
    return { visual: isChecking ? 'loading' : 'hidden', ...EMPTY_EVIDENCE };
  }
  if (result.evidence.handleClaim === null) {
    return { visual: 'hidden', ...EMPTY_EVIDENCE };
  }
  return {
    visual: visualForState(result.state),
    handle: result.evidence.handleClaim,
    repoDid: result.evidence.repoDid,
    recordUri: result.evidence.recordUri,
    direction1: result.evidence.direction1,
    direction2: result.evidence.direction2,
  };
}
