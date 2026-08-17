/**
 * `src/pear/handshake.ts` — mutual DID-challenge handshake over an
 * in-memory fake `PearConnection` pair (no worklet/hyperswarm involved;
 * that plumbing is `pearLane.test.ts`'s job — including the connection-
 * scoping regression coverage). `FakeChannelPair` wires two
 * `PearConnection`s (each with its own fixed `connId`, mirroring two
 * distinct physical connections) so `a.send()` delivers to `b`'s `onFrame`
 * listeners and vice versa, and `open()` fires a `_ctrl` 'open' event
 * (with `connId`) on both sides — mirroring what `lane.ts` does once
 * hyperswarm's Noise socket connects.
 */
import { describe, expect, it } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import { didKeyFromPublicKey, publicKeyFromPrivate, type Signer } from '@solidarity/shared';

import {
  authenticateChannel,
  HANDSHAKE_TIMEOUT_MS,
  type AuthenticatedChannel,
} from '../../src/pear/handshake';
import type { PearConnection, PearCtrlEvent } from '../../src/pear/lane';

// TEST-ONLY scalars — never used for anything but these fixtures (mirrors
// packages/shared/test/challenge.test.ts's fixed-hex-scalar convention).
const ALICE_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);
const ALICE_DID = didKeyFromPublicKey(publicKeyFromPrivate(ALICE_PRIV));
const aliceSigner: Signer = async (digest) => p256.sign(digest, ALICE_PRIV, { prehash: false });

const BOB_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
const BOB_DID = didKeyFromPublicKey(publicKeyFromPrivate(BOB_PRIV));
const bobSigner: Signer = async (digest) => p256.sign(digest, BOB_PRIV, { prehash: false });

// A third identity, used only to sign as "the wrong DID" — never a party to
// any real handshake in these tests.
const MALLORY_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 13 + 5) & 0xff);
const MALLORY_DID = didKeyFromPublicKey(publicKeyFromPrivate(MALLORY_PRIV));
const mallorySigner: Signer = async (digest) => p256.sign(digest, MALLORY_PRIV, { prehash: false });

class FakeSide implements PearConnection {
  readonly connId: number;
  readonly frameListeners = new Set<(frame: Record<string, unknown>) => void>();
  readonly ctrlListeners = new Set<(ev: PearCtrlEvent) => void>();
  closed = false;
  sent: Record<string, unknown>[] = [];
  private peer: FakeSide | null = null;

  constructor(connId: number) {
    this.connId = connId;
  }

  linkTo(peer: FakeSide): void {
    this.peer = peer;
  }

  send(frame: Record<string, unknown>): void {
    this.sent.push(frame);
    if (this.closed) return;
    this.peer?.deliver(frame);
  }

  deliver(frame: Record<string, unknown>): void {
    for (const cb of this.frameListeners) cb(frame);
  }

  onFrame(cb: (frame: Record<string, unknown>) => void): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  onCtrl(cb: (ev: PearCtrlEvent) => void): () => void {
    this.ctrlListeners.add(cb);
    return () => {
      this.ctrlListeners.delete(cb);
    };
  }

  close(): void {
    this.closed = true;
  }

  fireCtrl(ev: PearCtrlEvent): void {
    for (const cb of this.ctrlListeners) cb(ev);
  }
}

/** Two linked `FakeSide`s + an `open()` helper that fires 'open' on both. */
function fakeChannelPair(): { a: FakeSide; b: FakeSide; open: () => void } {
  const a = new FakeSide(1);
  const b = new FakeSide(2);
  a.linkTo(b);
  b.linkTo(a);
  return {
    a,
    b,
    open: () => {
      a.fireCtrl({ topic: 'test-topic', ev: 'open', connId: a.connId });
      b.fireCtrl({ topic: 'test-topic', ev: 'open', connId: b.connId });
    },
  };
}

describe('pear/handshake — authenticateChannel', () => {
  it('both-verify happy path: mutual authentication resolves ok on both sides', async () => {
    const { a, b, open } = fakeChannelPair();

    const aliceAuth = authenticateChannel(a, { myDid: ALICE_DID, peerDid: BOB_DID, signer: aliceSigner });
    const bobAuth = authenticateChannel(b, { myDid: BOB_DID, peerDid: ALICE_DID, signer: bobSigner });
    open();

    const [aliceResult, bobResult] = await Promise.all([aliceAuth, bobAuth]);

    expect(aliceResult.ok).toBe(true);
    expect(bobResult.ok).toBe(true);
    if (!aliceResult.ok || !bobResult.ok) return;
    expect(aliceResult.value.myDid).toBe(ALICE_DID);
    expect(aliceResult.value.peerDid).toBe(BOB_DID);
    expect(bobResult.value.myDid).toBe(BOB_DID);
    expect(bobResult.value.peerDid).toBe(ALICE_DID);
  });

  it('authenticated channel round-trips application frames after the handshake', async () => {
    const { a, b, open } = fakeChannelPair();

    const aliceAuth = authenticateChannel(a, { myDid: ALICE_DID, peerDid: BOB_DID, signer: aliceSigner });
    const bobAuth = authenticateChannel(b, { myDid: BOB_DID, peerDid: ALICE_DID, signer: bobSigner });
    open();
    const [aliceResult, bobResult] = await Promise.all([aliceAuth, bobAuth]);

    expect(aliceResult.ok).toBe(true);
    expect(bobResult.ok).toBe(true);
    if (!aliceResult.ok || !bobResult.ok) return;

    const received: Record<string, unknown>[] = [];
    bobResult.value.onFrame((f) => received.push(f));
    aliceResult.value.send({ t: 'app.hello', v: 1 });

    expect(received).toEqual([{ t: 'app.hello', v: 1 }]);
  });

  it('rejects a challenge.response signed by the wrong DID', async () => {
    const { a, b, open } = fakeChannelPair();

    // Bob's channel is driven manually here so we can substitute a response
    // signed by Mallory instead of Bob.
    let bobChallenge: Record<string, unknown> | null = null;
    b.onFrame((frame) => {
      if (frame['t'] === 'challenge') bobChallenge = frame['c'] as Record<string, unknown>;
    });

    const aliceAuth = authenticateChannel(a, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 200,
    });
    open();

    // Wait a tick for Alice's challenge to arrive at Bob's fake side.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bobChallenge).not.toBeNull();

    const { respondChallenge } = await import('@solidarity/shared');
    const jws = await respondChallenge(bobChallenge as never, MALLORY_DID, mallorySigner);
    b.send({ t: 'challenge.response', jws });

    const aliceResult = await aliceAuth;
    expect(aliceResult.ok).toBe(false);
    if (aliceResult.ok) return;
    expect(aliceResult.error).toContain('verification');
    expect(a.closed).toBe(true);
  });

  it('rejects a replayed response signed for a different purpose (field mismatch)', async () => {
    const { a, b, open } = fakeChannelPair();

    let bobChallenge: Record<string, unknown> | null = null;
    b.onFrame((frame) => {
      if (frame['t'] === 'challenge') bobChallenge = frame['c'] as Record<string, unknown>;
    });

    const aliceAuth = authenticateChannel(a, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 200,
    });
    open();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(bobChallenge).not.toBeNull();

    const { buildChallenge, respondChallenge } = await import('@solidarity/shared');
    // Bob signs a *different* challenge object (same nonce/requester/subject
    // but a different purpose) — simulates replaying a signed response that
    // was legitimately issued for a different context (e.g. verify.scan).
    const forged = buildChallenge({
      requester: (bobChallenge as unknown as { requester: string }).requester,
      subject: (bobChallenge as unknown as { subject: string }).subject,
      purpose: 'verify.scan',
      nonce: (bobChallenge as unknown as { nonce: string }).nonce,
      ts: (bobChallenge as unknown as { ts: number }).ts,
    });
    const jws = await respondChallenge(forged, BOB_DID, bobSigner);
    b.send({ t: 'challenge.response', jws });

    const aliceResult = await aliceAuth;
    expect(aliceResult.ok).toBe(false);
    if (aliceResult.ok) return;
    expect(aliceResult.error).toContain('verification');
    expect(a.closed).toBe(true);
  });

  it('times out when the peer never responds', async () => {
    const { a } = fakeChannelPair();

    const aliceAuth = authenticateChannel(a, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 20,
    });
    // Alice's own side opens, but Bob's side (and thus a response) never
    // arrives — this intentionally never calls the pair's `open()`.
    a.fireCtrl({ topic: 'test-topic', ev: 'open', connId: a.connId });

    const result = await aliceAuth;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('timed out');
    expect(a.closed).toBe(true);
  });

  it('rejects a non-handshake data frame that arrives before authentication', async () => {
    const { a, b, open } = fakeChannelPair();

    const aliceAuth = authenticateChannel(a, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 200,
    });
    open();

    // Bob (not yet authenticated on Alice's side) sends an application frame
    // instead of playing the handshake protocol.
    b.send({ t: 'card.request' });

    const result = await aliceAuth;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('protocol violation');
    expect(a.closed).toBe(true);
  });

  it('rejects a challenge not addressed to this pairing (wrong subject)', async () => {
    const { a } = fakeChannelPair();

    const aliceAuth = authenticateChannel(a, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 200,
    });
    a.fireCtrl({ topic: 'test-topic', ev: 'open', connId: a.connId });

    const { buildChallenge, randomChallengeNonce } = await import('@solidarity/shared');
    const misdirected = buildChallenge({
      requester: BOB_DID,
      subject: MALLORY_DID, // not addressed to Alice
      purpose: 'pear.card',
      nonce: randomChallengeNonce(),
      ts: Math.floor(Date.now() / 1000),
    });
    a.deliver({ t: 'challenge', c: misdirected });

    const result = await aliceAuth;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('protocol violation');
  });

  it('closes the channel and resolves err when the channel reports an error before authentication', async () => {
    const { a } = fakeChannelPair();

    const aliceAuth = authenticateChannel(a, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 200,
    });
    a.fireCtrl({ topic: 'test-topic', ev: 'error', message: 'connection reset' });

    const result = await aliceAuth;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('connection reset');
    expect(a.closed).toBe(true);
  });

  it('exports HANDSHAKE_TIMEOUT_MS as 15000ms', () => {
    expect(HANDSHAKE_TIMEOUT_MS).toBe(15_000);
  });

  it('type-checks AuthenticatedChannel shape (compile-time smoke)', () => {
    const shape: AuthenticatedChannel = {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      send: () => undefined,
      onFrame: () => () => undefined,
      close: () => undefined,
    };
    expect(typeof shape.send).toBe('function');
  });
});
