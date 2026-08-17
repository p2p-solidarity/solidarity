import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import type { AtprotoBindingIO } from '@solidarity/shared';
import { didKeyFromPublicKey, hexToBytes, ok, signCompact, type Signer } from '@solidarity/shared';

import { resolveProfileByHandle } from '../../src/handles/resolveProfile';
import { verifyProfileJws, type VerifiedPageResult } from '../../src/scan/verifiedPageHandler';
import ensVectors from '../../../../packages/shared/vectors/ens-handle.json';

const SUBJECT_PRIVATE = hexToBytes(
  '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
);
const OTHER_PRIVATE = hexToBytes(
  '02030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f2021'
);
const SUBJECT_DID = didKeyFromPublicKey(p256.getPublicKey(SUBJECT_PRIVATE, false));
const OTHER_DID = didKeyFromPublicKey(p256.getPublicKey(OTHER_PRIVATE, false));
const NPUB = ensVectors.expectedNpub;

function profile(did: string, alsoKnownAs: readonly string[]) {
  return {
    v: 1 as const,
    did,
    displayName: 'Alice',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [...alsoKnownAs],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-19T00:00:00Z',
  };
}

async function verifiedResult(
  did: string,
  privateKey: Uint8Array,
  alsoKnownAs: readonly string[]
): Promise<VerifiedPageResult> {
  const signer: Signer = async (digest) => p256.sign(digest, privateKey, { prehash: false });
  const jws = await signCompact(profile(did, alsoKnownAs), did, signer);
  return verifyProfileJws(jws);
}

function dnsIo(pointer: string): AtprotoBindingIO {
  return {
    dnsTxt: async () => ok([pointer]),
    fetchText: async () => ok(null),
    getRecord: async () => ok(null),
  };
}

describe('resolveProfileByHandle', () => {
  it('resolves dns → source npub → matching signed profile and returns a verified DNS badge', async () => {
    const fetched = await verifiedResult(SUBJECT_DID, SUBJECT_PRIVATE, ['dns:example.com']);
    const result = await resolveProfileByHandle('dns:example.com', {
      io: dnsIo(`did=${SUBJECT_DID};src=nostr:${NPUB}`),
      fetchNostrProfile: async () => fetched,
    });

    expect(result.kind).toBe('verified');
    if (result.kind !== 'verified') return;
    expect(result.record.did).toBe(SUBJECT_DID);
    expect(result.handleBinding).toEqual({
      scheme: 'dns',
      handle: 'example.com',
      state: 'verified',
    });
  });

  it('keeps a signed one-way DNS claim visible but marks its badge declared', async () => {
    const fetched = await verifiedResult(SUBJECT_DID, SUBJECT_PRIVATE, []);
    const result = await resolveProfileByHandle('dns:example.com', {
      io: dnsIo(`did=${SUBJECT_DID};src=nostr:${NPUB}`),
      fetchNostrProfile: async () => fetched,
    });

    expect(result.kind).toBe('verified');
    if (result.kind === 'verified') expect(result.handleBinding?.state).toBe('declared');
  });

  it('rejects a src npub whose JWS-verified profile belongs to another DID', async () => {
    const fetched = await verifiedResult(OTHER_DID, OTHER_PRIVATE, ['dns:example.com']);
    const result = await resolveProfileByHandle('dns:example.com', {
      io: dnsIo(`did=${SUBJECT_DID};src=nostr:${NPUB}`),
      fetchNostrProfile: async () => fetched,
    });

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.reason).toBe('bindingMismatch');
  });

  it('rejects a bare DID pointer before relay retrieval when no profile source is advertised', async () => {
    let fetchCalls = 0;
    const result = await resolveProfileByHandle('dns:example.com', {
      io: dnsIo(SUBJECT_DID),
      fetchNostrProfile: async () => {
        fetchCalls += 1;
        return await verifiedResult(SUBJECT_DID, SUBJECT_PRIVATE, ['dns:example.com']);
      },
    });

    expect(result).toEqual({
      kind: 'invalid',
      reason: 'profileSourceMissing',
      detail: 'the handle resolves to a DID but does not advertise a supported profile source',
    });
    expect(fetchCalls).toBe(0);
  });

  it('resolves ENS through the same profile retrieval and reverse-binding path', async () => {
    let ethCalls = 0;
    const io: AtprotoBindingIO = {
      dnsTxt: async () => ok([]),
      fetchText: async () => ok(null),
      getRecord: async () => ok(null),
      ethCall: async () => {
        ethCalls += 1;
        return ok(ethCalls === 1 ? ensVectors.resolverResponse : ensVectors.pointerResponse);
      },
    };
    const fetched = await verifiedResult(SUBJECT_DID, SUBJECT_PRIVATE, ['ens:vitalik.eth']);

    const result = await resolveProfileByHandle('Vitalik.ETH', {
      io,
      fetchNostrProfile: async () => fetched,
    });

    expect(result.kind).toBe('verified');
    if (result.kind === 'verified') {
      expect(result.handleBinding).toEqual({
        scheme: 'ens',
        handle: 'vitalik.eth',
        state: 'verified',
      });
    }
  });

  it('reads an ATProto repository record and keeps ATProto ahead of bare DNS', async () => {
    const repoDid = 'did:plc:aliceexample1234';
    const signed = await verifiedResult(SUBJECT_DID, SUBJECT_PRIVATE, ['at://alice.example']);
    if (signed.kind !== 'verified') throw new Error('fixture did not verify');
    const io: AtprotoBindingIO = {
      dnsTxt: async (name) =>
        name === '_atproto.alice.example'
          ? ok([`did=${repoDid}`])
          : ok([`did=${SUBJECT_DID};src=nostr:${NPUB}`]),
      fetchText: async () => ok(null),
      getRecord: async () =>
        ok({
          uri: `at://${repoDid}/app.solidarity.profile/self`,
          value: { jws: signed.jws },
        }),
    };

    const result = await resolveProfileByHandle('alice.example', { io });

    expect(result.kind).toBe('verified');
    if (result.kind === 'verified') expect(result.handleBinding?.scheme).toBe('atproto');
  });
});
