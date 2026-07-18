/**
 * `src/pear/mutualExchange.ts` — the T5 symmetric two-way card exchange,
 * driven over the same in-memory `FakeAuthChannel` pair as
 * `pearProtocol.test.ts`. Covers the happy path plus the research §8 Pear
 * attack surface: decline, disconnect-after-save (non-atomic, no rollback),
 * duplicate retry (idempotent by exchangeId), wrong-peer JWS, injected
 * stale/newer/equal-time merge outcomes, concurrent exchanges, and
 * pre/post-accept close.
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  signCompact,
  PROFILE_VERSION,
  type ProfileRecord,
  type Signer,
} from '@solidarity/shared';

import {
  createMutualExchange,
  evaluateIncomingOffer,
  profileDigest,
  MAX_EXCHANGE_CARD_BYTES,
  type CardExchangeOffer,
  type MergeKind,
  type MutualExchangeResult,
} from '../../src/pear/mutualExchange';
import type { AuthenticatedChannel } from '../../src/pear/handshake';
// Type-only: pins MergeKind to the store's merge-outcome kinds at typecheck
// (erased at runtime — pulls no MMKV).
import type { SnapshotMergeOutcome } from '../../src/people/profileSnapshots';

const ALICE_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);
const ALICE_DID = didKeyFromPublicKey(publicKeyFromPrivate(ALICE_PRIV));
const aliceSigner: Signer = async (digest) => p256.sign(digest, ALICE_PRIV, { prehash: false });

const BOB_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
const BOB_DID = didKeyFromPublicKey(publicKeyFromPrivate(BOB_PRIV));
const bobSigner: Signer = async (digest) => p256.sign(digest, BOB_PRIV, { prehash: false });

const MALLORY_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 13 + 5) & 0xff);
const MALLORY_DID = didKeyFromPublicKey(publicKeyFromPrivate(MALLORY_PRIV));
const mallorySigner: Signer = async (digest) => p256.sign(digest, MALLORY_PRIV, { prehash: false });

function testProfile(did: string, displayName = 'Test User'): ProfileRecord {
  return {
    v: PROFILE_VERSION,
    did,
    displayName,
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-10T00:00:00.000Z',
  };
}

async function makeOffer(did: string, signer: Signer, displayName = 'Test User'): Promise<CardExchangeOffer> {
  const record = testProfile(did, displayName);
  const card = await signCompact(record, did, signer);
  return { card, record };
}

class FakeAuthChannel implements AuthenticatedChannel {
  readonly myDid: string;
  readonly peerDid: string;
  private peer: FakeAuthChannel | null = null;
  private readonly listeners = new Set<(frame: Record<string, unknown>) => void>();
  closed = false;
  readonly sent: Record<string, unknown>[] = [];

  constructor(myDid: string, peerDid: string) {
    this.myDid = myDid;
    this.peerDid = peerDid;
  }

  linkTo(peer: FakeAuthChannel): void {
    this.peer = peer;
  }

  send(frame: Record<string, unknown>): void {
    this.sent.push(frame);
    if (this.closed) return;
    this.peer?.deliver(frame);
  }

  deliver(frame: Record<string, unknown>): void {
    for (const cb of this.listeners) cb(frame);
  }

  onFrame(cb: (frame: Record<string, unknown>) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  close(): void {
    this.closed = true;
  }
}

function fakePair(): { alice: FakeAuthChannel; bob: FakeAuthChannel } {
  const alice = new FakeAuthChannel(ALICE_DID, BOB_DID);
  const bob = new FakeAuthChannel(BOB_DID, ALICE_DID);
  alice.linkTo(bob);
  bob.linkTo(alice);
  return { alice, bob };
}

interface SaveSpy {
  readonly fn: (record: ProfileRecord, jws: string) => MergeKind;
  readonly calls: { record: ProfileRecord; jws: string }[];
}

function saveSpy(returns: MergeKind = 'saved'): SaveSpy {
  const calls: { record: ProfileRecord; jws: string }[] = [];
  return {
    calls,
    fn: (record, jws) => {
      calls.push({ record, jws });
      return returns;
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('pear/mutualExchange — createMutualExchange', () => {
  it('happy path: both sides swap cards, save independently, and confirm via receipts', async () => {
    const { alice, bob } = fakePair();
    const aliceEx = createMutualExchange(alice);
    const bobEx = createMutualExchange(bob);

    const aliceSave = saveSpy('saved');
    const bobSave = saveSpy('saved');
    const bobOffer = await makeOffer(BOB_DID, bobSigner, 'Bob');
    const captured: { result: MutualExchangeResult | null } = { result: null };

    bobEx.onExchangeRequest({
      decide: async () => ({ accept: true, offer: bobOffer }),
      saveIncoming: bobSave.fn,
      onComplete: (r) => {
        captured.result = r;
      },
    });

    const aliceOffer = await makeOffer(ALICE_DID, aliceSigner, 'Alice');
    const result = await aliceEx.startExchange({
      exchangeId: 'x-1',
      offer: aliceOffer,
      saveIncoming: aliceSave.fn,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.localSave).toBe('saved'); // Alice saved Bob's card
    expect(result.value.peerReceipt).toBe('saved'); // Bob confirmed saving Alice's

    // Both actually persisted (once each) — Alice got Bob's, Bob got Alice's.
    expect(aliceSave.calls).toHaveLength(1);
    expect(aliceSave.calls[0]?.record.did).toBe(BOB_DID);
    expect(bobSave.calls).toHaveLength(1);
    expect(bobSave.calls[0]?.record.did).toBe(ALICE_DID);

    expect(captured.result).not.toBeNull();
    expect(captured.result?.localSave).toBe('saved');
    expect(captured.result?.peerReceipt).toBe('saved');
  });

  it('decline: peer declines → err(declined), and NO card material was ever offered', async () => {
    const { alice, bob } = fakePair();
    const aliceEx = createMutualExchange(alice);
    const bobEx = createMutualExchange(bob);
    const aliceSave = saveSpy();

    bobEx.onExchangeRequest({
      decide: async () => ({ accept: false }),
      saveIncoming: saveSpy().fn,
    });

    const result = await aliceEx.startExchange({
      exchangeId: 'x-2',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: aliceSave.fn,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('declined');
    // Alice never sent an offer (only the request), and saved nothing.
    expect(alice.sent.some((f) => f['t'] === 'card.exchange.offer')).toBe(false);
    expect(aliceSave.calls).toHaveLength(0);
  });

  it('injected merge outcome flows to localSave AND the peer receipt (stale/newer/conflict)', async () => {
    for (const kind of ['keptNewer', 'conflict', 'alreadyCurrent'] as const) {
      const { alice, bob } = fakePair();
      const aliceEx = createMutualExchange(alice);
      const bobEx = createMutualExchange(bob);

      bobEx.onExchangeRequest({
        decide: async () => ({ accept: true, offer: await makeOffer(BOB_DID, bobSigner) }),
        // Bob's local policy decides to keep his newer copy of Alice's card, etc.
        saveIncoming: saveSpy(kind).fn,
      });

      const result = await aliceEx.startExchange({
        exchangeId: `x-${kind}`,
        offer: await makeOffer(ALICE_DID, aliceSigner),
        saveIncoming: saveSpy('saved').fn, // Alice saved Bob's normally
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.localSave).toBe('saved');
      // Bob's receipt honestly carries HIS merge outcome for Alice's card.
      expect(result.value.peerReceipt).toBe(kind);
    }
  });

  it('wrong-peer JWS: a card signed by a THIRD party is rejected → localSave "failed", never saved', async () => {
    // Lone Alice; we hand-inject the peer frames to control exactly what she
    // receives (a forged offer signed by Mallory, not Bob).
    const alice = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const aliceEx = createMutualExchange(alice, { timeoutMs: 40 });
    const aliceSave = saveSpy('saved');

    const pending = aliceEx.startExchange({
      exchangeId: 'x-forge',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: aliceSave.fn,
    });
    const reqId = alice.sent.at(-1)?.['reqId'];

    // Peer accepts, then offers a card signed by Mallory (did = Mallory) —
    // it verifies fine against Mallory's key but NOT against the authenticated
    // Bob peer DID.
    alice.deliver({ t: 'card.exchange.accept', reqId, exchangeId: 'x-forge' });
    const forged = await signCompact(testProfile(MALLORY_DID), MALLORY_DID, mallorySigner);
    alice.deliver({ t: 'card.exchange.offer', exchangeId: 'x-forge', card: forged, digest: 'whatever' });
    // Then a receipt so Alice can settle (peer claims it saved Alice's card).
    alice.deliver({
      t: 'card.exchange.receipt',
      exchangeId: 'x-forge',
      digest: profileDigest(testProfile(ALICE_DID)),
      status: 'saved',
    });

    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.localSave).toBe('failed'); // forged card rejected
    expect(aliceSave.calls).toHaveLength(0); // never persisted
    // Alice honestly receipts 'failed' back to the peer.
    const receipt = alice.sent.find((f) => f['t'] === 'card.exchange.receipt');
    expect(receipt?.['status']).toBe('failed');
  });

  it('non-atomic: peer receives our offer but never acks → localSave stands, peerReceipt "unknown", NO rollback', async () => {
    const alice = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const aliceEx = createMutualExchange(alice, { timeoutMs: 30 });
    const aliceSave = saveSpy('saved');

    const pending = aliceEx.startExchange({
      exchangeId: 'x-drop',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: aliceSave.fn,
    });
    const reqId = alice.sent.at(-1)?.['reqId'];

    // Peer accepts and offers its (valid) card — Alice saves it — but then the
    // peer disconnects: NO receipt for Alice's offer ever arrives.
    alice.deliver({ t: 'card.exchange.accept', reqId, exchangeId: 'x-drop' });
    const bobCard = await signCompact(testProfile(BOB_DID), BOB_DID, bobSigner);
    alice.deliver({ t: 'card.exchange.offer', exchangeId: 'x-drop', card: bobCard, digest: profileDigest(testProfile(BOB_DID)) });

    const result = await pending; // resolves on timeout with partials
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.localSave).toBe('saved'); // our save is NOT rolled back
    expect(result.value.peerReceipt).toBe('unknown'); // never heard back
    expect(aliceSave.calls).toHaveLength(1);
  });

  it('duplicate retry: a repeated request for the SAME exchangeId is idempotent — decide runs once', async () => {
    const { alice, bob } = fakePair();
    createMutualExchange(alice);
    const bobEx = createMutualExchange(bob);

    let decideCalls = 0;
    const gate: { release: ((d: { accept: true; offer: CardExchangeOffer }) => void) | null } = { release: null };
    const bobOffer = await makeOffer(BOB_DID, bobSigner);
    bobEx.onExchangeRequest({
      decide: () =>
        new Promise((resolve) => {
          decideCalls += 1;
          gate.release = resolve;
        }),
      saveIncoming: saveSpy().fn,
    });

    const reqFrame = { t: 'card.exchange.request', reqId: 1, exchangeId: 'dup', v: 1, digest: 'd', size: 100, updatedAt: '2026-07-10T00:00:00Z' };
    alice.send(reqFrame); // first — starts decide (pending)
    alice.send({ ...reqFrame, reqId: 2 }); // duplicate while consent open — dropped
    await tick();
    expect(decideCalls).toBe(1);

    // Resolve consent — exactly one accept goes out.
    gate.release?.({ accept: true, offer: bobOffer });
    await tick();
    expect(bob.sent.filter((f) => f['t'] === 'card.exchange.accept')).toHaveLength(1);

    // A later duplicate (now decided) re-sends accept + offer, still no re-prompt.
    alice.send({ ...reqFrame, reqId: 3 });
    await tick();
    expect(decideCalls).toBe(1);
    expect(bob.sent.filter((f) => f['t'] === 'card.exchange.accept')).toHaveLength(2);
  });

  it('concurrent exchanges: a DIFFERENT exchangeId while one is active is auto-declined', async () => {
    const { alice, bob } = fakePair();
    createMutualExchange(alice);
    const bobEx = createMutualExchange(bob);

    let decideCalls = 0;
    const gate: { release: ((d: { accept: false }) => void) | null } = { release: null };
    bobEx.onExchangeRequest({
      decide: () =>
        new Promise((resolve) => {
          decideCalls += 1;
          gate.release = resolve;
        }),
      saveIncoming: saveSpy().fn,
    });

    const base = { t: 'card.exchange.request', v: 1, digest: 'd', size: 100, updatedAt: '2026-07-10T00:00:00Z' };
    alice.send({ ...base, reqId: 1, exchangeId: 'A' }); // active (deciding)
    alice.send({ ...base, reqId: 2, exchangeId: 'B' }); // concurrent, different id
    await tick();

    expect(decideCalls).toBe(1); // second never reached the handler
    const declineForB = bob.sent.find((f) => f['t'] === 'card.exchange.decline' && f['exchangeId'] === 'B');
    expect(declineForB).toBeDefined();
    expect(declineForB?.['reqId']).toBe(2);
  });

  it('startExchange while one is in flight is rejected immediately (protocol), no second request on the wire', async () => {
    const alice = new FakeAuthChannel(ALICE_DID, BOB_DID); // lone — first request hangs awaiting accept
    const aliceEx = createMutualExchange(alice, { timeoutMs: 5_000 });

    const first = aliceEx.startExchange({
      exchangeId: 'x-a',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: saveSpy().fn,
    });
    const second = await aliceEx.startExchange({
      exchangeId: 'x-b',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: saveSpy().fn,
    });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.kind).toBe('protocol');
    expect(alice.sent.filter((f) => f['t'] === 'card.exchange.request')).toHaveLength(1);

    aliceEx.close();
    await first;
  });

  it('close() before accept resolves err(protocol); after accept resolves ok with partials', async () => {
    // Pre-accept close.
    const a1 = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const ex1 = createMutualExchange(a1, { timeoutMs: 5_000 });
    const p1 = ex1.startExchange({
      exchangeId: 'x-c1',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: saveSpy().fn,
    });
    ex1.close();
    const r1 = await p1;
    expect(r1.ok).toBe(false);
    if (r1.ok) return;
    expect(r1.error.kind).toBe('protocol');
    expect(a1.closed).toBe(true);

    // Post-accept close → ok partials (nothing to roll back).
    const a2 = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const ex2 = createMutualExchange(a2, { timeoutMs: 5_000 });
    const save2 = saveSpy('saved');
    const p2 = ex2.startExchange({
      exchangeId: 'x-c2',
      offer: await makeOffer(ALICE_DID, aliceSigner),
      saveIncoming: save2.fn,
    });
    const reqId = a2.sent.at(-1)?.['reqId'];
    a2.deliver({ t: 'card.exchange.accept', reqId, exchangeId: 'x-c2' });
    ex2.close();
    const r2 = await p2;
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.localSave).toBe('notReceived'); // never got their card
    expect(r2.value.peerReceipt).toBe('unknown');
  });

  it('orphan/mismatch frames are reported, not thrown, and never misapplied', async () => {
    const alice = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const aliceEx = createMutualExchange(alice, { timeoutMs: 5_000 });
    const errors: string[] = [];
    aliceEx.onProtocolError((e) => errors.push(e.message));

    // A receipt for an exchange that doesn't exist.
    expect(() => {
      alice.deliver({ t: 'card.exchange.receipt', exchangeId: 'ghost', digest: 'd', status: 'saved' });
    }).not.toThrow();
    expect(errors.some((m) => m.includes('no matching active exchange'))).toBe(true);
  });
});

describe('pear/mutualExchange — evaluateIncomingOffer (pure trust checks)', () => {
  it('accepts a card correctly signed by the peer with a matching embedded DID', async () => {
    const card = await signCompact(testProfile(BOB_DID), BOB_DID, bobSigner);
    const result = evaluateIncomingOffer(card, BOB_DID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.record.did).toBe(BOB_DID);
    expect(result.value.digest).toBe(profileDigest(testProfile(BOB_DID)));
  });

  it('rejects a card whose signer is not the authenticated peer DID', async () => {
    const forged = await signCompact(testProfile(MALLORY_DID), MALLORY_DID, mallorySigner);
    const result = evaluateIncomingOffer(forged, BOB_DID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toContain('verification');
  });

  it('rejects a validly-signed card whose embedded record.did is NOT the peer DID', async () => {
    // Signed by Bob's key, but the payload claims to be Mallory's DID.
    const card = await signCompact(testProfile(MALLORY_DID), BOB_DID, bobSigner);
    const result = evaluateIncomingOffer(card, BOB_DID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toContain('does not match');
  });

  it('rejects a validly-signed but non-ProfileRecord payload', async () => {
    const card = await signCompact({ hello: 'world' }, BOB_DID, bobSigner);
    const result = evaluateIncomingOffer(card, BOB_DID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toContain('profile validation');
  });

  it('rejects an oversized card before doing any crypto', () => {
    const huge = 'a'.repeat(MAX_EXCHANGE_CARD_BYTES + 1);
    const result = evaluateIncomingOffer(huge, BOB_DID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toContain('byte cap');
  });

  it('profileDigest is deterministic for equal content and differs across content', () => {
    expect(profileDigest(testProfile(BOB_DID))).toBe(profileDigest(testProfile(BOB_DID)));
    expect(profileDigest(testProfile(BOB_DID, 'One'))).not.toBe(profileDigest(testProfile(BOB_DID, 'Two')));
  });

  it('MergeKind stays aligned with the store SnapshotMergeOutcome kinds', () => {
    // Compile-time guard (both directions); the runtime line just keeps it live.
    type A = MergeKind extends SnapshotMergeOutcome['kind'] ? true : false;
    type B = SnapshotMergeOutcome['kind'] extends MergeKind ? true : false;
    const aligned: A & B = true;
    expect(aligned).toBe(true);
  });
});
