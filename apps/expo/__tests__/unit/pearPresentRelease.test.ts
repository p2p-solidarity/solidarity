/**
 * `src/pear/presentRelease.ts` — the pure responder-side consent decision
 * logic for A5.3's SD-JWT presentation (what `onPresentRequest`'s handler
 * actually does). No React/RN/biometric module involved — every dependency
 * is injected, so this pins the exact sequence (match → consent → biometric
 * → build) and the "never leak an undisclosed claim on any decline path"
 * contract. Mirrors `pearCardRelease.test.ts`'s structure.
 */
import { describe, expect, it } from 'bun:test';

import type { PresentableClaim } from '../../src/pear/presentBuilder';
import {
  makePresentRequestHandler,
  type PresentReleaseDeps,
} from '../../src/pear/presentRelease';

const CLAIM_A: PresentableClaim = { id: 'a', claimType: 'age_over_18', title: 'I am over 18' };
const CLAIM_B: PresentableClaim = { id: 'b', claimType: 'nationality', title: 'Nationality' };

function tracker() {
  const calls: string[] = [];
  return { calls };
}

describe('makePresentRequestHandler', () => {
  it('no matching claims -> declined immediately, never shows consent or biometric', async () => {
    const { calls } = tracker();
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => {
        calls.push('getMatchedClaims');
        return [];
      },
      askConsent: async () => {
        calls.push('askConsent');
        return { decision: 'decline' };
      },
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return true;
      },
      buildPresentation: async () => {
        calls.push('buildPresentation');
        return { ok: true, sdJwt: 'x' };
      },
    };
    const result = await makePresentRequestHandler(deps)(['age_over_18']);
    expect(result).toEqual({ declined: true });
    expect(calls).toEqual(['getMatchedClaims']);
  });

  it('share with a selection + biometric ok + build ok -> returns the sdJwt', async () => {
    const { calls } = tracker();
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => {
        calls.push('getMatchedClaims');
        return [CLAIM_A, CLAIM_B];
      },
      askConsent: async () => {
        calls.push('askConsent');
        return { decision: 'share', selectedClaimIds: ['a'] };
      },
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return true;
      },
      buildPresentation: async (ids) => {
        calls.push(`buildPresentation:${ids.join(',')}`);
        return { ok: true, sdJwt: 'the-sd-jwt' };
      },
    };
    const result = await makePresentRequestHandler(deps)(['age_over_18', 'nationality']);
    expect(result).toEqual({ sdJwt: 'the-sd-jwt' });
    expect(calls).toEqual(['getMatchedClaims', 'askConsent', 'requireBiometric', 'buildPresentation:a']);
  });

  it('only the SELECTED claim ids are forwarded to buildPresentation — unselected claims never leak', async () => {
    let forwarded: readonly string[] = [];
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => [CLAIM_A, CLAIM_B],
      askConsent: async () => ({ decision: 'share', selectedClaimIds: ['a'] }),
      requireBiometric: async () => true,
      buildPresentation: async (ids) => {
        forwarded = ids;
        return { ok: true, sdJwt: 'jwt' };
      },
    };
    await makePresentRequestHandler(deps)(['age_over_18', 'nationality']);
    expect(forwarded).toEqual(['a']);
    expect(forwarded).not.toContain('b');
  });

  it('decline -> declined, and never touches biometric or build', async () => {
    const { calls } = tracker();
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => [CLAIM_A],
      askConsent: async () => {
        calls.push('askConsent');
        return { decision: 'decline' };
      },
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return true;
      },
      buildPresentation: async () => {
        calls.push('buildPresentation');
        return { ok: true, sdJwt: 'x' };
      },
    };
    const result = await makePresentRequestHandler(deps)(['age_over_18']);
    expect(result).toEqual({ declined: true });
    expect(calls).toEqual(['askConsent']);
  });

  it('share with ZERO claims selected -> declined, same as an explicit decline', async () => {
    const { calls } = tracker();
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => [CLAIM_A],
      askConsent: async () => ({ decision: 'share', selectedClaimIds: [] }),
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return true;
      },
      buildPresentation: async () => {
        calls.push('buildPresentation');
        return { ok: true, sdJwt: 'x' };
      },
    };
    const result = await makePresentRequestHandler(deps)(['age_over_18']);
    expect(result).toEqual({ declined: true });
    expect(calls).toEqual([]);
  });

  it('share + biometric denied -> declined, never builds a presentation', async () => {
    const { calls } = tracker();
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => [CLAIM_A],
      askConsent: async () => ({ decision: 'share', selectedClaimIds: ['a'] }),
      requireBiometric: async () => {
        calls.push('requireBiometric');
        return false;
      },
      buildPresentation: async () => {
        calls.push('buildPresentation');
        return { ok: true, sdJwt: 'x' };
      },
    };
    const result = await makePresentRequestHandler(deps)(['age_over_18']);
    expect(result).toEqual({ declined: true });
    expect(calls).toEqual(['requireBiometric']);
  });

  it('build failure -> declined, never fabricates an sdJwt', async () => {
    const deps: PresentReleaseDeps = {
      getMatchedClaims: () => [CLAIM_A],
      askConsent: async () => ({ decision: 'share', selectedClaimIds: ['a'] }),
      requireBiometric: async () => true,
      buildPresentation: async () => ({ ok: false, message: 'signing failed' }),
    };
    const result = await makePresentRequestHandler(deps)(['age_over_18']);
    expect(result).toEqual({ declined: true });
  });

  it('"no matching credential", "consent denied", and "build failed" are all the same wire shape', async () => {
    const noMatch = await makePresentRequestHandler({
      getMatchedClaims: () => [],
      askConsent: async () => ({ decision: 'share', selectedClaimIds: ['a'] }),
      requireBiometric: async () => true,
      buildPresentation: async () => ({ ok: true, sdJwt: 'x' }),
    })(['age_over_18']);

    const declinedByUser = await makePresentRequestHandler({
      getMatchedClaims: () => [CLAIM_A],
      askConsent: async () => ({ decision: 'decline' }),
      requireBiometric: async () => true,
      buildPresentation: async () => ({ ok: true, sdJwt: 'x' }),
    })(['age_over_18']);

    const buildFailed = await makePresentRequestHandler({
      getMatchedClaims: () => [CLAIM_A],
      askConsent: async () => ({ decision: 'share', selectedClaimIds: ['a'] }),
      requireBiometric: async () => true,
      buildPresentation: async () => ({ ok: false, message: 'boom' }),
    })(['age_over_18']);

    expect(noMatch).toEqual(declinedByUser);
    expect(declinedByUser).toEqual(buildFailed);
  });
});
