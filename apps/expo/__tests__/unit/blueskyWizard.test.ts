import { describe, expect, it } from 'bun:test';

import {
  beginBlueskyConnect,
  classifyAtprotoOAuthError,
  confirmBlueskyReplacement,
  normalizeBlueskyHandle,
  type BlueskyWizardDependencies,
} from '@/atproto/blueskyWizard';
import type { AtprotoConnectOutcome } from '@/atproto/connect';
import type { AtprotoSession } from '@/atproto/session';
import { err, ok, type ProfileRecord, type VerifyAtprotoBindingResult } from '@solidarity/shared';

const HANDLE = 'alice.bsky.social';
const REPO_DID = 'did:plc:aliceexample1234';

const SESSION: AtprotoSession = {
  did: REPO_DID,
  handle: HANDLE,
  pdsUrl: 'https://pds.example.social',
  authServerIssuer: 'https://auth.example.social',
  tokenEndpoint: 'https://auth.example.social/oauth/token',
  accessToken: 'access-token',
  accessTokenExpiresAtMs: Date.now() + 300_000,
  scope: 'atproto transition:generic',
};

const PROFILE: ProfileRecord = {
  v: 1,
  did: 'did:key:zDnaSolidarityProfileOwner',
  displayName: 'Alice',
  avatar: null,
  bio: '',
  links: [],
  alsoKnownAs: [`at://${HANDLE}`],
  badges: [],
  supersededBy: null,
  updatedAt: '2026-07-16T00:00:00.000Z',
};

function verification(state: VerifyAtprotoBindingResult['state']): VerifyAtprotoBindingResult {
  return {
    state,
    handle: HANDLE,
    evidence: {
      handleClaim: HANDLE,
      repoDid: REPO_DID,
      recordUri: `at://${REPO_DID}/app.solidarity.profile/self`,
      direction1: true,
      direction2: state === 'verified' ? true : state === 'stale' ? null : false,
      reason: state,
    },
  };
}

function dependencies(
  events: string[],
  connectOutcome: AtprotoConnectOutcome = {
    kind: 'connected',
    handle: HANDLE,
    repoDid: REPO_DID,
  },
  verified = verification('verified')
): BlueskyWizardDependencies {
  return {
    startOAuth: (handle, options) => {
      events.push(`oauth:${handle}:${options?.browserLauncher ? 'injected' : 'default'}`);
      return Promise.resolve(ok(SESSION));
    },
    connect: (_session, options) => {
      events.push(`connect:${options.confirmReplacement === true ? 'confirmed' : 'initial'}`);
      return Promise.resolve(ok(connectOutcome));
    },
    getSession: () => {
      events.push('readSession');
      return Promise.resolve(ok(SESSION));
    },
    readProfile: () => {
      events.push('readProfile');
      return Promise.resolve(PROFILE);
    },
    verifyBinding: () => {
      events.push('verify');
      return Promise.resolve(verified);
    },
  };
}

describe('Bluesky connect wizard orchestration', () => {
  it('accepts one @ prefix, normalizes before OAuth, and forwards the injected browser seam', async () => {
    const events: string[] = [];
    const browserLauncher = () => Promise.resolve({ type: 'cancel' as const });

    const result = await beginBlueskyConnect(
      '  @Alice.BSKY.Social  ',
      { browserLauncher },
      dependencies(events)
    );

    expect(normalizeBlueskyHandle('  @Alice.BSKY.Social  ')).toBe(HANDLE);
    expect(result.ok && result.value.kind).toBe('connected');
    expect(result.ok && result.value.kind === 'connected' && result.value.verification.state).toBe(
      'verified'
    );
    expect(events).toEqual([
      `oauth:${HANDLE}:injected`,
      'connect:initial',
      'readProfile',
      'verify',
    ]);
  });

  it('rejects malformed handles before OAuth or any other IO', async () => {
    const events: string[] = [];
    const result = await beginBlueskyConnect('not a handle', {}, dependencies(events));

    expect(result).toEqual({ ok: false, error: { kind: 'invalidHandle' } });
    expect(events).toEqual([]);
  });

  it('maps cancellation to a kind-keyed error without exposing the raw OAuth message', async () => {
    const events: string[] = [];
    const deps: BlueskyWizardDependencies = {
      ...dependencies(events),
      startOAuth: () => Promise.resolve(err('user cancelled the atproto sign-in')),
    };

    const result = await beginBlueskyConnect(HANDLE, {}, deps);

    expect(result).toEqual({ ok: false, error: { kind: 'oauthCancelled' } });
    expect(events).toEqual([]);
  });

  it('classifies the pending hosted client-metadata failure as its own honest retry state', () => {
    expect(classifyAtprotoOAuthError('authorization server rejected: invalid_client')).toEqual({
      kind: 'clientMetadataUnavailable',
    });
    expect(classifyAtprotoOAuthError('network error while fetching metadata')).toEqual({
      kind: 'networkUnavailable',
    });
    expect(classifyAtprotoOAuthError('state mismatch')).toEqual({ kind: 'oauthFailed' });
  });

  it('surfaces replacement before profile IO, then confirms with the same OAuth session', async () => {
    const events: string[] = [];
    const replacement: AtprotoConnectOutcome = {
      kind: 'replacementConfirmationRequired',
      existingHandle: 'old.example.social',
      replacementHandle: HANDLE,
    };
    const deps = dependencies(events, replacement);

    const initial = await beginBlueskyConnect(HANDLE, {}, deps);
    expect(initial.ok && initial.value.kind).toBe('replacementConfirmationRequired');
    expect(initial.ok && initial.value).not.toHaveProperty('session');
    expect(events).toEqual([`oauth:${HANDLE}:default`, 'connect:initial']);

    const confirmedDeps = dependencies(events);
    if (!initial.ok || initial.value.kind !== 'replacementConfirmationRequired') {
      throw new Error('expected replacement confirmation');
    }
    const confirmed = await confirmBlueskyReplacement(initial.value, confirmedDeps);

    expect(confirmed.ok && confirmed.value.kind).toBe('connected');
    expect(events.slice(2)).toEqual(['readSession', 'connect:confirmed', 'readProfile', 'verify']);
  });

  it('fails closed if the persisted OAuth account changes while replacement confirmation is open', async () => {
    const events: string[] = [];
    const replacement: AtprotoConnectOutcome = {
      kind: 'replacementConfirmationRequired',
      existingHandle: 'old.example.social',
      replacementHandle: HANDLE,
    };
    const initial = await beginBlueskyConnect(HANDLE, {}, dependencies(events, replacement));
    if (!initial.ok || initial.value.kind !== 'replacementConfirmationRequired') {
      throw new Error('expected replacement confirmation');
    }
    const switchedSession = { ...SESSION, did: 'did:plc:differentaccount' };
    const deps: BlueskyWizardDependencies = {
      ...dependencies(events),
      getSession: () => Promise.resolve(ok(switchedSession)),
    };

    const result = await confirmBlueskyReplacement(initial.value, deps);

    expect(result).toEqual({ ok: false, error: { kind: 'sessionIdentityMismatch' } });
    expect(events).toEqual([`oauth:${HANDLE}:default`, 'connect:initial']);
  });

  it('returns the verifier state unchanged instead of fabricating a green success', async () => {
    const result = await beginBlueskyConnect(
      HANDLE,
      {},
      dependencies([], undefined, verification('declared'))
    );

    expect(result.ok && result.value.kind === 'connected' && result.value.verification.state).toBe(
      'declared'
    );
  });
});
