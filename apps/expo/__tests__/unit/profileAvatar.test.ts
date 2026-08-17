import { describe, expect, it } from 'bun:test';

import {
  parseBlueskyAvatarResponse,
  resolveProfileAvatarSource,
} from '../../src/profile/avatar';

describe('parseBlueskyAvatarResponse', () => {
  it('accepts an https avatar from the public Bluesky profile response', () => {
    expect(
      parseBlueskyAvatarResponse({
        did: 'did:plc:alice',
        handle: 'alice.bsky.social',
        avatar: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/example@jpeg',
      })
    ).toEqual({
      ok: true,
      value: 'https://cdn.bsky.app/img/avatar/plain/did:plc:alice/example@jpeg',
    });
  });

  it('reports that a valid profile has no avatar without inventing one', () => {
    expect(parseBlueskyAvatarResponse({ did: 'did:plc:alice', avatar: null })).toEqual({
      ok: false,
      error: 'avatarUnavailable',
    });
  });

  it('rejects malformed response shapes', () => {
    expect(parseBlueskyAvatarResponse(null)).toEqual({
      ok: false,
      error: 'invalidResponse',
    });
    expect(parseBlueskyAvatarResponse({ avatar: 42 })).toEqual({
      ok: false,
      error: 'invalidResponse',
    });
  });

  it('rejects a non-https remote avatar', () => {
    expect(parseBlueskyAvatarResponse({ avatar: 'http://cdn.example/avatar.jpg' })).toEqual({
      ok: false,
      error: 'insecureAvatar',
    });
  });
});

describe('resolveProfileAvatarSource', () => {
  it('prefers a safe signed-record avatar over the device-only photo', () => {
    expect(
      resolveProfileAvatarSource(
        'https://cdn.bsky.app/avatar.jpg',
        'file:///documents/profile-avatar/local.jpg'
      )
    ).toBe('https://cdn.bsky.app/avatar.jpg');
  });

  it('falls back to the device-only file when the record avatar is not https', () => {
    expect(
      resolveProfileAvatarSource(
        'http://unsafe.example/avatar.jpg',
        'file:///documents/profile-avatar/local.jpg'
      )
    ).toBe('file:///documents/profile-avatar/local.jpg');
  });

  it('returns null instead of rendering an unsafe or unknown scheme', () => {
    expect(resolveProfileAvatarSource('data:image/png;base64,abc', null)).toBeNull();
    expect(resolveProfileAvatarSource(null, 'content://picker/temporary')).toBeNull();
  });
});
