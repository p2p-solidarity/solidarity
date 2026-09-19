import { describe, expect, it } from 'bun:test';

import {
  buildProfileShareUrlSelection,
  displayProfileShareUrl,
  pickBestShareUrl,
  type ProfileShareModel,
  type ProfileShareUrlCandidate,
} from '@/components/me/meProfileModel';

const OFFLINE: ProfileShareUrlCandidate = {
  kind: 'offline',
  url: 'https://creds.id/#offline',
};
const SHORT: ProfileShareUrlCandidate = {
  kind: 'short',
  url: 'https://creds.id/#nostr:npub1alice',
};

describe('pickBestShareUrl', () => {
  it('prefers the official short name and contains no long fragment', () => {
    const username: ProfileShareUrlCandidate = {
      kind: 'username',
      url: 'https://creds.id/@alice',
      displayUrl: 'https://creds.id/@alice',
    };

    expect(pickBestShareUrl([OFFLINE, SHORT, username])).toEqual({
      kind: 'ready',
      candidate: username,
    });
    expect(displayProfileShareUrl(username)).toBe('creds.id/@alice');
  });

  it('selects a currently verified handle ahead of the npub and offline formats', () => {
    const verifiedHandle: ProfileShareUrlCandidate = {
      kind: 'handle',
      url: 'https://creds.id/@alice.example',
      isVerified: true,
    };

    expect(pickBestShareUrl([OFFLINE, SHORT, verifiedHandle])).toEqual({
      kind: 'ready',
      candidate: verifiedHandle,
    });
  });

  it('skips an unverified handle instead of offering a link that may not resolve', () => {
    const unverifiedHandle: ProfileShareUrlCandidate = {
      kind: 'handle',
      url: 'https://creds.id/@alice.example',
      isVerified: false,
    };

    expect(pickBestShareUrl([unverifiedHandle, SHORT, OFFLINE])).toEqual({
      kind: 'ready',
      candidate: SHORT,
    });
  });

  it('falls back to the npub short link when no verified handle is available', () => {
    expect(pickBestShareUrl([OFFLINE, SHORT])).toEqual({
      kind: 'ready',
      candidate: SHORT,
    });
  });

  it('keeps the offline fragment behind an unpublished state when no short format is ready', () => {
    expect(pickBestShareUrl([OFFLINE])).toEqual({
      kind: 'unpublished',
      offline: OFFLINE,
    });
  });

  it('returns an error state when there is no real URL to share', () => {
    expect(pickBestShareUrl([])).toEqual({ kind: 'error' });
  });
});

describe('buildProfileShareUrlSelection', () => {
  const model: ProfileShareModel = {
    offlineUrl: OFFLINE.url,
    usernameUrl: null,
    usernameDisplayUrl: null,
    shortUrl: SHORT.url,
    oversize: false,
  };

  it('withholds a stale or never-published npub pointer without recommending the offline URL', () => {
    expect(buildProfileShareUrlSelection(model, null, false)).toEqual({
      candidates: [OFFLINE],
      selection: { kind: 'unpublished', offline: OFFLINE },
    });
  });

  it('offers /name first when onboarding has stored a valid username', () => {
    const usernameModel: ProfileShareModel = {
      ...model,
      usernameUrl: 'https://creds.id/@alice',
      usernameDisplayUrl: 'https://creds.id/@alice',
    };

    const resolution = buildProfileShareUrlSelection(usernameModel, null, false);
    const usernameCandidate: ProfileShareUrlCandidate = {
      kind: 'username',
      url: 'https://creds.id/@alice',
      displayUrl: 'https://creds.id/@alice',
    };
    expect(resolution.selection).toEqual({ kind: 'ready', candidate: usernameCandidate });
    expect(resolution.candidates[0]).toEqual(usernameCandidate);
  });
});
