import type { HandleResolutionResult } from '../handles';
import type { ProfileRecord } from '../profile';

import type { BadgeState } from './types';

export interface HandleBindingEvidence {
  readonly expectedAlsoKnownAs: string;
  readonly resolvedDid: string | null;
  /** Fresh handle → DID lookup: null means the lookup could not complete. */
  readonly direction1: boolean | null;
  /** Fetched profile reciprocates both DID and alsoKnownAs: null while direction 1 is unknown. */
  readonly direction2: boolean | null;
  readonly profileDidMatches: boolean | null;
  readonly alsoKnownAsMatches: boolean;
  readonly reason: string;
}

export interface VerifyHandleBindingResult {
  readonly state: BadgeState;
  readonly handle: string;
  readonly evidence: HandleBindingEvidence;
}

export function verifyResolvedHandleBinding(
  profile: ProfileRecord,
  scheme: 'dns' | 'ens',
  normalizedHandle: string,
  resolution: HandleResolutionResult
): VerifyHandleBindingResult {
  const expectedAlsoKnownAs = `${scheme}:${normalizedHandle}`;
  const alsoKnownAsMatches = profile.alsoKnownAs.includes(expectedAlsoKnownAs);

  if (!resolution.ok) {
    if (resolution.error === 'unreachable') {
      return {
        state: 'stale',
        handle: normalizedHandle,
        evidence: {
          expectedAlsoKnownAs,
          resolvedDid: null,
          direction1: null,
          direction2: null,
          profileDidMatches: null,
          alsoKnownAsMatches,
          reason: 'handle lookup is unreachable right now — the binding cannot be refreshed',
        },
      };
    }

    const revoked = resolution.error === 'notFound';
    return {
      state: revoked ? 'revoked' : 'declared',
      handle: normalizedHandle,
      evidence: {
        expectedAlsoKnownAs,
        resolvedDid: null,
        direction1: false,
        direction2: false,
        profileDidMatches: null,
        alsoKnownAsMatches,
        reason: revoked
          ? 'the fresh forward record is absent — the binding has been revoked'
          : `the fresh forward record is not verifiable: ${resolution.error}`,
      },
    };
  }

  if (!('did' in resolution.value)) {
    return {
      state: 'declared',
      handle: normalizedHandle,
      evidence: {
        expectedAlsoKnownAs,
        resolvedDid: null,
        direction1: false,
        direction2: false,
        profileDidMatches: null,
        alsoKnownAsMatches,
        reason: 'the selected DID resolver returned a different handle-record kind',
      },
    };
  }

  const profileDidMatches = profile.did === resolution.value.did;
  const direction2 = profileDidMatches && alsoKnownAsMatches;
  return {
    state: direction2 ? 'verified' : 'declared',
    handle: normalizedHandle,
    evidence: {
      expectedAlsoKnownAs,
      resolvedDid: resolution.value.did,
      direction1: true,
      direction2,
      profileDidMatches,
      alsoKnownAsMatches,
      reason: direction2
        ? 'both directions confirmed: the handle resolves to this DID and the signed profile claims it back'
        : profileDidMatches
          ? 'one-way only: the handle resolves to this DID, but the signed profile does not claim it back'
          : 'binding rejected: the fetched signed profile belongs to a different DID',
    },
  };
}
