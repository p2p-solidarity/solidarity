import { describe, expect, it } from 'bun:test';
import { profileShareQrIsOversize } from '@/components/me/profileShareQr';
import type { ProfileShareModel, ProfileShareUrlCandidate } from '@/components/me/meProfileModel';

const OFFLINE: ProfileShareUrlCandidate = {
  kind: 'offline',
  url: 'https://app.solidarity.gg/#large-fragment',
};

describe('profile share QR capacity', () => {
  it('blocks an oversized self-contained profile from being rendered as a QR code', () => {
    const model: Pick<ProfileShareModel, 'oversize'> = { oversize: true };

    expect(profileShareQrIsOversize(OFFLINE, model)).toBe(true);
  });

  it('does not block compact or separately-sized link formats', () => {
    const oversized: Pick<ProfileShareModel, 'oversize'> = { oversize: true };
    const compact: Pick<ProfileShareModel, 'oversize'> = { oversize: false };

    expect(profileShareQrIsOversize({ kind: 'short', url: 'https://app.solidarity.gg/#npub' }, oversized)).toBe(false);
    expect(
      profileShareQrIsOversize(
        {
          kind: 'username',
          url: 'https://app.solidarity.gg/@kidney',
          displayUrl: 'https://app.solidarity.gg/@kidney',
        },
        oversized,
      ),
    ).toBe(false);
    expect(profileShareQrIsOversize(OFFLINE, compact)).toBe(false);
  });
});
