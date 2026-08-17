/**
 * resolveProfileByNpub — the `#nostr:<npub>` short-pointer inbound resolver
 * (src/nostr/resolveProfile.ts). Pins the two security gates the offline
 * fragment path doesn't have:
 *   1. the embedded did:key JWS signature must verify (a relay delivering
 *      tampered/forged content → `verificationFailed`, never accepted);
 *   2. the resolved profile's `alsoKnownAs` must claim the SAME npub back
 *      (a relay substituting a different, validly-signed profile →
 *      `bindingMismatch`).
 * Plus the reachability honesty split (`notFound` vs `unreachable`).
 *
 * Relay IO is injected (`subscribeEventsFn`) — no real WebSocket. The signed
 * profile fixture reuses packages/shared's own test key, same as
 * verifiedPageHandler.test.ts, so a JWS built here is cross-checkable.
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import type { NostrEvent } from '@/dag/nostrAdapter';
import type { SubscribeEventsFn } from '@/nostr/publish';
import { hexToBytes, signCompact, type Signer } from '@solidarity/shared';

import { fetchVerifiedProfileByNpub, resolveProfileByNpub } from '../../src/nostr/resolveProfile';

const SUBJECT_PRIV = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20');
const SUBJECT_DID = 'did:key:zDnaeVuZeVRqvscGkiEoR9PFFra2xZUMp97ZPuGFK1VLU7iYN';
const subjectSigner: Signer = async (digest) => p256.sign(digest, SUBJECT_PRIV, { prehash: false });

// A real NIP-19 npub (nostr-tools reference vector) — `npubDecode` accepts it.
const NPUB = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';

function profile(alsoKnownAs: readonly string[]): object {
  return {
    v: 1,
    did: SUBJECT_DID,
    displayName: 'Alice',
    avatar: null,
    bio: 'hello',
    links: [],
    alsoKnownAs,
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-03T00:00:00Z',
  };
}

async function pointerEvent(alsoKnownAs: readonly string[]): Promise<NostrEvent> {
  const jws = await signCompact(profile(alsoKnownAs), SUBJECT_DID, subjectSigner);
  return {
    id: '00'.repeat(32),
    pubkey: 'ab'.repeat(32),
    created_at: 1_700_000_000,
    kind: 30078,
    tags: [['d', 'solidarity.profile']],
    content: jws,
    sig: '00'.repeat(64),
  };
}

/** Mock relay: emits the given events then EOSE (a "confirmed" answer). */
function fakeSubscribe(eventsByRelay: Readonly<Record<string, readonly NostrEvent[]>>): SubscribeEventsFn {
  return (relay, _filter, onEvent, onEose) => {
    setTimeout(() => {
      for (const e of eventsByRelay[relay] ?? []) onEvent(e);
      onEose?.();
    }, 0);
    return { subscriptionId: `fake-${relay}`, close: () => undefined };
  };
}

describe('resolveProfileByNpub', () => {
  it('exposes signature-verified retrieval without requiring a Nostr badge reverse claim', async () => {
    const ev = await pointerEvent([]);
    const r = await fetchVerifiedProfileByNpub(NPUB, {
      relays: ['a'],
      subscribeEventsFn: fakeSubscribe({ a: [ev] }),
    });

    expect(r.kind).toBe('verified');
    if (r.kind === 'verified') expect(r.record.did).toBe(SUBJECT_DID);
  });

  it('resolves a published + reverse-bound profile to verified', async () => {
    const ev = await pointerEvent([`nostr:${NPUB}`]);
    const r = await resolveProfileByNpub(NPUB, { relays: ['a'], subscribeEventsFn: fakeSubscribe({ a: [ev] }) });
    expect(r.kind).toBe('verified');
    if (r.kind !== 'verified') return;
    expect(r.record.did).toBe(SUBJECT_DID);
    expect(r.record.displayName).toBe('Alice');
  });

  it('rejects a profile that does NOT claim the npub back (relay substitution) → bindingMismatch', async () => {
    const ev = await pointerEvent([]); // valid signature, but no nostr:<npub> binding
    const r = await resolveProfileByNpub(NPUB, { relays: ['a'], subscribeEventsFn: fakeSubscribe({ a: [ev] }) });
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    expect(r.reason).toBe('bindingMismatch');
  });

  it('rejects a tampered JWS the relay delivered → verificationFailed (relay can forge bytes, not signatures)', async () => {
    const good = await pointerEvent([`nostr:${NPUB}`]);
    const flipped = good.content.slice(0, -2) + (good.content.endsWith('A') ? 'B' : 'A');
    const tampered: NostrEvent = { ...good, content: flipped };
    const r = await resolveProfileByNpub(NPUB, { relays: ['a'], subscribeEventsFn: fakeSubscribe({ a: [tampered] }) });
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    // Either the signature check or the pre-check catches it — both are honest failures.
    expect(['verificationFailed', 'malformedPayload', 'schemaInvalid']).toContain(r.reason);
  });

  it('maps "relay confirmed no event" to notFound', async () => {
    const r = await resolveProfileByNpub(NPUB, { relays: ['a'], subscribeEventsFn: fakeSubscribe({ a: [] }) });
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    expect(r.reason).toBe('notFound');
  });

  it('maps "every relay errored before EOSE" to unreachable (not notFound)', async () => {
    const erroring: SubscribeEventsFn = (relay, _filter, _onEvent, _onEose, onError) => {
      setTimeout(() => onError?.('boom'), 0);
      return { subscriptionId: `err-${relay}`, close: () => undefined };
    };
    const r = await resolveProfileByNpub(NPUB, { relays: ['a'], subscribeEventsFn: erroring });
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    expect(r.reason).toBe('unreachable');
  });

  it('rejects a malformed npub before any relay call → malformedPayload', async () => {
    const r = await resolveProfileByNpub('not-an-npub', { relays: ['a'], subscribeEventsFn: fakeSubscribe({ a: [] }) });
    expect(r.kind).toBe('invalid');
    if (r.kind !== 'invalid') return;
    expect(r.reason).toBe('malformedPayload');
  });
});
