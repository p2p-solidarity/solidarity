/**
 * `src/pear/protocol.ts` — the Pear v1 application protocol state machine,
 * driven over an in-memory fake `AuthenticatedChannel` pair (mirrors
 * `pearHandshake.test.ts`'s `FakeSide` pattern, minus the ctrl-event
 * machinery `AuthenticatedChannel` doesn't expose). No worklet/hyperswarm
 * involved — that plumbing is `pearLane.test.ts`'s job, and mutual DID
 * authentication itself is `pearHandshake.test.ts`'s job. This suite
 * exercises the card/present request-response dispatch, the "no request id
 * on the wire" concurrency rule, and every fail-closed path documented in
 * `protocol.ts`'s module header.
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
  createPearSession,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PearProtocolError,
  type PearSession,
} from '../../src/pear/protocol';
import type { AuthenticatedChannel } from '../../src/pear/handshake';

// TEST-ONLY scalars — mirrors packages/shared/test/challenge.test.ts's
// fixed-hex-scalar convention (also used by pearHandshake.test.ts).
const ALICE_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);
const ALICE_DID = didKeyFromPublicKey(publicKeyFromPrivate(ALICE_PRIV));

const BOB_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
const BOB_DID = didKeyFromPublicKey(publicKeyFromPrivate(BOB_PRIV));
const bobSigner: Signer = async (digest) => p256.sign(digest, BOB_PRIV, { prehash: false });

// A third identity — used only to sign a card under the WRONG did, proving
// the receiver actually checks the signer instead of trusting the JWS raw.
const MALLORY_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 13 + 5) & 0xff);
const MALLORY_DID = didKeyFromPublicKey(publicKeyFromPrivate(MALLORY_PRIV));
const mallorySigner: Signer = async (digest) => p256.sign(digest, MALLORY_PRIV, { prehash: false });

function testProfile(did: string): ProfileRecord {
  return {
    v: PROFILE_VERSION,
    did,
    displayName: 'Test User',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [],
    badges: [],
    supersededBy: null,
    updatedAt: new Date(0).toISOString(),
  };
}

async function signedCard(did: string, signer: Signer): Promise<string> {
  return signCompact(testProfile(did), did, signer);
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

  /** Deliver a frame as if it arrived from the peer — used both for normal
   *  relay (via `send`) and to inject raw/malformed frames a well-behaved
   *  peer implementation would never construct. */
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

function fakeAuthPair(): { alice: FakeAuthChannel; bob: FakeAuthChannel } {
  const alice = new FakeAuthChannel(ALICE_DID, BOB_DID);
  const bob = new FakeAuthChannel(BOB_DID, ALICE_DID);
  alice.linkTo(bob);
  bob.linkTo(alice);
  return { alice, bob };
}

function collectProtocolErrors(session: PearSession): PearProtocolError[] {
  const out: PearProtocolError[] = [];
  session.onProtocolError((e) => out.push(e));
  return out;
}

describe('pear/protocol — createPearSession', () => {
  it('happy path: card.request -> card.offer, offered card verifies against the peer DID', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    const card = await signedCard(BOB_DID, bobSigner);
    bobSession.onCardRequest(async () => ({ cardJws: card }));

    const result = await aliceSession.requestCard();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.cardJws).toBe(card);
  });

  it('happy path: present.request -> present.response relays claims out and sdJwt back', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    const captured: { claims: readonly string[] | null } = { claims: null };
    bobSession.onPresentRequest(async (claims) => {
      captured.claims = claims;
      return { sdJwt: 'sd-jwt~disclosure1~disclosure2' };
    });

    const result = await aliceSession.requestPresentation(['over_18', 'name']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sdJwt).toBe('sd-jwt~disclosure1~disclosure2');
    expect(captured.claims).toEqual(['over_18', 'name']);
  });

  it('decline path: card.request answered with card.decline resolves err', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    bobSession.onCardRequest(async () => ({ declined: true }));

    const result = await aliceSession.requestCard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('declined');
    expect(result.error.message).toContain('declined');
  });

  it('decline path: present.request answered with present.decline resolves err', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    bobSession.onPresentRequest(async () => ({ declined: true }));

    const result = await aliceSession.requestPresentation(['over_18']);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('declined');
    expect(result.error.message).toContain('declined');
  });

  it('no handler registered -> incoming request is auto-declined, never hangs', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    createPearSession(bob); // bob's session exists but registers no handlers

    const cardResult = await aliceSession.requestCard();
    expect(cardResult.ok).toBe(false);

    const presentResult = await aliceSession.requestPresentation(['over_18']);
    expect(presentResult.ok).toBe(false);
  });

  it('handler that throws is treated as a decline, not an unhandled rejection', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);
    const bobErrors = collectProtocolErrors(bobSession);

    bobSession.onCardRequest(async () => {
      throw new Error('handler blew up');
    });

    const result = await aliceSession.requestCard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('declined');
    expect(result.error.message).toContain('declined');
    expect(bobErrors.some((e) => e.message.includes('handler threw'))).toBe(true);
  });

  it('offered-card-fails-verification: card signed by the wrong DID is rejected, not trusted raw', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    // Bob offers a card signed by Mallory instead of himself.
    const forgedCard = await signedCard(MALLORY_DID, mallorySigner);
    bobSession.onCardRequest(async () => ({ cardJws: forgedCard }));

    const result = await aliceSession.requestCard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('verification');
    expect(result.error.message).toContain('verification');
  });

  it('offered-card-fails-verification: validly-signed but non-profile-shaped payload is rejected', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    // Signed correctly by Bob, but the payload isn't a valid ProfileRecord
    // (missing every required field) — verifyCompact passes, parseProfile
    // must not.
    const notAProfile = await signCompact({ hello: 'world' }, BOB_DID, bobSigner);
    bobSession.onCardRequest(async () => ({ cardJws: notAProfile }));

    const result = await aliceSession.requestCard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('verification');
    expect(result.error.message).toContain('profile validation');
  });

  it('malformed frame (missing field) settles the pending request with err, never throws', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    // No session on bob's side — a real bobSession with no handler would
    // auto-decline alice's card.request before this test gets to inject the
    // malformed response it actually wants to exercise.

    const pending = aliceSession.requestCard();
    const reqId = alice.sent.at(-1)?.['reqId'];
    // Bob's transport sends a card.offer with no `card` field — something a
    // conforming session never constructs, so inject it directly. Echoes
    // the real reqId alice's request carried, so this exercises the
    // malformed-field path rather than getting dropped as a reqId mismatch.
    bob.send({ t: 'card.offer', reqId });

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
    expect(result.error.message).toContain('malformed');
  });

  it('malformed present.response (missing sdJwt field) settles the pending request with err, never throws', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    // No bobSession — inject the malformed response frame directly, mirroring
    // the malformed-card.offer test above for the presentation side.

    const pending = aliceSession.requestPresentation(['over_18']);
    const reqId = alice.sent.at(-1)?.['reqId'];
    bob.send({ t: 'present.response', reqId });

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('malformed');
    expect(result.error.message).toContain('malformed');
  });

  it('malformed present.request (claims not a string array) is ignore-and-reported, never throws', () => {
    const { alice, bob } = fakeAuthPair();
    createPearSession(alice);
    const bobSession = createPearSession(bob);
    const bobErrors = collectProtocolErrors(bobSession);

    expect(() => {
      alice.send({ t: 'present.request', claims: 'not-an-array', reqId: 1 });
    }).not.toThrow();
    expect(bobErrors.some((e) => e.message.includes('claims'))).toBe(true);
  });

  it('unknown message type is ignore-and-reported, and the session stays usable afterward', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);
    const aliceErrors = collectProtocolErrors(aliceSession);

    alice.deliver({ t: 'pear.v2.some-future-message', payload: 42 });
    expect(aliceErrors.some((e) => e.message.includes('unknown pear protocol message type'))).toBe(true);
    expect(alice.closed).toBe(false);

    // Follow-up legitimate request still works — one bad frame didn't wedge
    // or tear down the session.
    const card = await signedCard(BOB_DID, bobSigner);
    bobSession.onCardRequest(async () => ({ cardJws: card }));
    const result = await aliceSession.requestCard();
    expect(result.ok).toBe(true);
  });

  it('response-without-request: an orphaned card.offer is ignore-and-reported, not applied to anything', () => {
    const { alice } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const aliceErrors = collectProtocolErrors(aliceSession);

    alice.deliver({ t: 'card.offer', card: 'unsolicited.jws.here' });
    expect(aliceErrors.some((e) => e.message.includes('no outstanding card.request'))).toBe(true);
  });

  it('out-of-order response: a present.response arriving with no pending present.request is dropped, not misattributed', async () => {
    const { alice } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    // No session on the peer side — this test drives responses by hand via
    // `alice.deliver(...)` to control ordering precisely; a real bobSession
    // with no handler would auto-decline and race the manual injection.
    const aliceErrors = collectProtocolErrors(aliceSession);

    // No requestPresentation() call happened — this response is unsolicited.
    alice.deliver({ t: 'present.response', sdJwt: 'unsolicited-sd-jwt' });
    expect(aliceErrors.some((e) => e.message.includes('no outstanding present.request'))).toBe(true);

    // A genuine, subsequently-issued present.request must still resolve
    // cleanly against its own (fresh) pending slot.
    const result = aliceSession.requestPresentation(['over_18']);
    const reqId = alice.sent.at(-1)?.['reqId'];
    alice.deliver({ t: 'present.response', sdJwt: 'the-real-one', reqId });
    const resolved = await result;
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.value.sdJwt).toBe('the-real-one');
  });

  it('concurrent-same-type: a second requestCard() while one is in flight is rejected immediately, first still resolves', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    const card = await signedCard(BOB_DID, bobSigner);
    bobSession.onCardRequest(async () => ({ cardJws: card }));

    const first = aliceSession.requestCard();
    const second = await aliceSession.requestCard();

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.kind).toBe('protocol');
      expect(second.error.message).toContain('already in flight');
    }
    // Only one card.request frame was actually sent — the second call never
    // touched the wire.
    expect(alice.sent.filter((f) => f['t'] === 'card.request')).toHaveLength(1);

    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });

  it('concurrent-same-type: requesting a card and a presentation concurrently does not collide (independent per-type slots)', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice);
    const bobSession = createPearSession(bob);

    const card = await signedCard(BOB_DID, bobSigner);
    bobSession.onCardRequest(async () => ({ cardJws: card }));
    bobSession.onPresentRequest(async () => ({ sdJwt: 'sd-jwt-value' }));

    const [cardResult, presentResult] = await Promise.all([
      aliceSession.requestCard(),
      aliceSession.requestPresentation(['over_18']),
    ]);

    expect(cardResult.ok).toBe(true);
    expect(presentResult.ok).toBe(true);
  });

  it('incoming concurrent requests of the same type: second card.request while the first handler is pending is auto-declined, handler invoked once', async () => {
    const { alice, bob } = fakeAuthPair();
    createPearSession(alice);
    const bobSession = createPearSession(bob);

    let handlerInvocations = 0;
    const handlerBox: { resolve: ((r: { cardJws: string }) => void) | null } = { resolve: null };
    bobSession.onCardRequest(
      () =>
        new Promise((resolve) => {
          handlerInvocations += 1;
          handlerBox.resolve = resolve;
        })
    );

    // Two requests land back-to-back before the (async) handler resolves.
    alice.send({ t: 'card.request', reqId: 1 });
    alice.send({ t: 'card.request', reqId: 2 });

    // Let the second (auto-declined) response arrive.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bob.sent.filter((f) => f['t'] === 'card.decline')).toHaveLength(1);
    expect(handlerInvocations).toBe(1);

    const card = await signedCard(BOB_DID, bobSigner);
    handlerBox.resolve?.({ cardJws: card });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(bob.sent.filter((f) => f['t'] === 'card.offer')).toHaveLength(1);
  });

  it('request timeout resolves err after the configured window with no response', async () => {
    // A lone channel with no linked peer — `send` is a no-op sink, so the
    // request genuinely never gets an answer.
    const alone = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const session = createPearSession(alone, { requestTimeoutMs: 15 });

    const result = await session.requestCard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('timeout');
    expect(result.error.message).toContain('timed out');
  });

  it('exports DEFAULT_REQUEST_TIMEOUT_MS as 30000ms', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it('close() settles any outstanding request with err instead of leaving it pending forever', async () => {
    const alone = new FakeAuthChannel(ALICE_DID, BOB_DID);
    const session = createPearSession(alone, { requestTimeoutMs: 5_000 });

    const pending = session.requestCard();
    session.close();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('protocol');
    expect(result.error.message).toContain('closed');
    expect(alone.closed).toBe(true);
  });

  // --- reqId misattribution repro (reviewer-reported) -----------------
  // Reproduces: requestPresentation(#1) times out -> requestPresentation(#2)
  // issued into the freed slot -> peer's LATE answer to #1 arrives -> must
  // NOT resolve #2 with #1's data. Pre-fix, `protocol.ts` has no way to
  // tell #1's answer apart from #2's (same message type, one pending slot),
  // so the late frame is applied to whatever is currently pending — #2.
  it('REPRO: late present.response for a timed-out request #1 must not resolve a subsequently-issued request #2', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice, { requestTimeoutMs: 10 });
    const aliceErrors = collectProtocolErrors(aliceSession);

    const firstPromise = aliceSession.requestPresentation(['over_18']);
    const reqId1: unknown = alice.sent.at(-1)?.['reqId'];
    const first = await firstPromise;
    expect(first.ok).toBe(false); // request #1 timed out
    if (first.ok) return;
    expect(first.error.kind).toBe('timeout');

    const secondPromise = aliceSession.requestPresentation(['name']);
    const reqId2 = alice.sent.at(-1)?.['reqId'];
    expect(reqId2).not.toBe(reqId1);

    // Peer's late answer to request #1 finally shows up — reqId1, not reqId2.
    bob.send({ t: 'present.response', sdJwt: 'answer-to-req-1', reqId: reqId1 });
    // Dropped as stale/unmatched, reported for diagnostics, and (critically)
    // request #2's promise is untouched — it's still pending right here.
    expect(aliceErrors.some((e) => e.message.includes('reqId mismatch'))).toBe(true);

    // request #2 must still be waiting on its OWN answer, not #1's.
    bob.send({ t: 'present.response', sdJwt: 'answer-to-req-2', reqId: reqId2 });
    const second = await secondPromise;
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.sdJwt).toBe('answer-to-req-2'); // must not be 'answer-to-req-1'
  });

  it('REPRO (card variant): late card.offer for a timed-out request #1 must not resolve a subsequently-issued request #2', async () => {
    const { alice, bob } = fakeAuthPair();
    const aliceSession = createPearSession(alice, { requestTimeoutMs: 10 });
    const aliceErrors = collectProtocolErrors(aliceSession);

    const staleCard = await signCompact({ ...testProfile(BOB_DID), displayName: 'Stale Answer' }, BOB_DID, bobSigner);
    const freshCard = await signCompact({ ...testProfile(BOB_DID), displayName: 'Fresh Answer' }, BOB_DID, bobSigner);

    const firstPromise = aliceSession.requestCard();
    const reqId1: unknown = alice.sent.at(-1)?.['reqId'];
    const first = await firstPromise;
    expect(first.ok).toBe(false); // request #1 timed out
    if (first.ok) return;
    expect(first.error.kind).toBe('timeout');

    const secondPromise = aliceSession.requestCard();
    const reqId2 = alice.sent.at(-1)?.['reqId'];
    expect(reqId2).not.toBe(reqId1);

    bob.send({ t: 'card.offer', card: staleCard, reqId: reqId1 });
    expect(aliceErrors.some((e) => e.message.includes('reqId mismatch'))).toBe(true);

    bob.send({ t: 'card.offer', card: freshCard, reqId: reqId2 });
    const second = await secondPromise;
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.cardJws).toBe(freshCard); // must not be staleCard
  });

  it('type-checks: createPearSession takes an AuthenticatedChannel (structural gate against raw PearChannel)', () => {
    // Compile-time smoke: AuthenticatedChannel requires myDid/peerDid, which
    // a raw PearChannel (lane.ts) does not have — there is no way to pass an
    // unauthenticated channel to createPearSession and have it type-check.
    const shape: AuthenticatedChannel = {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      send: () => undefined,
      onFrame: () => () => undefined,
      close: () => undefined,
    };
    const session = createPearSession(shape);
    expect(typeof session.requestCard).toBe('function');
  });
});
