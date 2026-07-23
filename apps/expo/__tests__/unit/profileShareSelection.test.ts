import { describe, expect, it } from 'bun:test';

import {
  pickBestShareUrl,
  type ProfileShareUrlCandidate,
} from '@/components/me/meProfileModel';

const OFFLINE: ProfileShareUrlCandidate = {
  kind: 'offline',
  url: 'https://app.solidarity.gg/#offline',
};
const SHORT: ProfileShareUrlCandidate = {
  kind: 'short',
  url: 'https://app.solidarity.gg/#nostr:npub1alice',
};

describe('pickBestShareUrl', () => {
  it('selects a currently verified handle ahead of the npub and offline formats', () => {
    const verifiedHandle: ProfileShareUrlCandidate = {
      kind: 'handle',
      url: 'https://app.solidarity.gg/@alice.example',
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
      url: 'https://app.solidarity.gg/@alice.example',
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

  it('uses the offline fragment only when no shorter format is available', () => {
    expect(pickBestShareUrl([OFFLINE])).toEqual({
      kind: 'ready',
      candidate: OFFLINE,
    });
  });

  it('returns an error state when there is no real URL to share', () => {
    expect(pickBestShareUrl([])).toEqual({ kind: 'error' });
  });
});
