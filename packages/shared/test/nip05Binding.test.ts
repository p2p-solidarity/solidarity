import { describe, expect, it } from 'bun:test';

import {
  verifyNip05Binding,
  type ActiveNip05HandleResolutionValue,
  type ProfileRecord,
} from '../src';

const DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';
const PUBKEY = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';

const profile: ProfileRecord = {
  v: 1,
  did: DID,
  displayName: 'Alice',
  avatar: null,
  bio: '',
  links: [],
  alsoKnownAs: [`nostr:${NPUB}`],
  badges: [],
  supersededBy: null,
  updatedAt: '2026-08-13T00:00:00.000Z',
};

const resolution: ActiveNip05HandleResolutionValue = {
  kind: 'nip05',
  status: 'active',
  name: 'alice',
  identifier: 'alice@solidarity.gg',
  pubkey: PUBKEY,
  npub: NPUB,
  relays: ['wss://relay.example'],
  sources: [{ kind: 'nostr', npub: NPUB }],
  rebindGeneration: 0,
  reboundAt: null,
};

describe('verifyNip05Binding', () => {
  it('verifies only when the signed profile and Nostr kind-0 both claim the resolved identity', async () => {
    const result = await verifyNip05Binding(profile, resolution, async (pubkey) => ({
      contentJson: { nip05: 'alice@solidarity.gg', alsoKnownAs: [DID] },
      created_at: 1_776_038_400,
    }));

    expect(result).toEqual({
      state: 'verified',
      evidence: {
        directoryPubkey: PUBKEY,
        profileClaimsNpub: true,
        kind0ClaimsIdentifier: true,
        kind0ClaimsDid: true,
        kind0CreatedAt: 1_776_038_400,
        reason: 'all directions confirmed: directory, signed profile, and kind-0 agree',
      },
    });
  });
});
