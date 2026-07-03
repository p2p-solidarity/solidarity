/**
 * `src/pear/lane.ts` — `pearTopicFor` (pure) + `startLane`/`joinTopic`
 * envelope routing, with `react-native-bare-kit` stubbed by a fake
 * `Worklet`/`IPC` (native TurboModule — not available under `bun test`).
 * The fake's `IPC.emit()` simulates worklet -> RN traffic so we can drive
 * `routeEnvelope` without a real Bare thread; `IPC.written` captures what
 * `lane.ts` sent, decoded back with the same `frames.ts` codec used to
 * generate real reference vectors in `pearFrames.test.ts`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { p256 } from '@noble/curves/nist.js';

import {
  buildChallenge,
  bytesToHex,
  didKeyFromPublicKey,
  publicKeyFromPrivate,
  randomChallengeNonce,
  respondChallenge,
  sha256Bytes,
  type Signer,
} from '@solidarity/shared';

import { authenticateChannel } from '../../src/pear/handshake';
import { encodeFrame, FrameDecoder } from '../../src/pear/frames';
import type * as LaneModule from '../../src/pear/lane';

// TEST-ONLY scalars — mirrors pearHandshake.test.ts's fixed-hex-scalar
// convention. Used only by the connection-scoping security tests below.
const ALICE_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);
const ALICE_DID = didKeyFromPublicKey(publicKeyFromPrivate(ALICE_PRIV));
const aliceSigner: Signer = async (digest) => p256.sign(digest, ALICE_PRIV, { prehash: false });

const BOB_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
const BOB_DID = didKeyFromPublicKey(publicKeyFromPrivate(BOB_PRIV));
const bobSigner: Signer = async (digest) => p256.sign(digest, BOB_PRIV, { prehash: false });

class FakeIpc {
  readonly written: Uint8Array[] = [];
  private readonly handlers = new Set<(chunk: Uint8Array) => void>();

  on(event: string, cb: (chunk: Uint8Array) => void): this {
    if (event === 'data') this.handlers.add(cb);
    return this;
  }

  off(event: string, cb: (chunk: Uint8Array) => void): this {
    if (event === 'data') this.handlers.delete(cb);
    return this;
  }

  write(chunk: Uint8Array): void {
    this.written.push(chunk);
  }

  /** Test-only — simulates a frame arriving from the worklet. */
  emit(chunk: Uint8Array): void {
    for (const handler of this.handlers) handler(chunk);
  }

  /** Test-only — simulates the worklet sending an envelope object directly
   *  (bypasses hand-encoding a frame in every test). */
  emitEnvelope(envelope: Record<string, unknown>): void {
    const encoded = encodeFrame(envelope);
    if (!encoded.ok) throw new Error('test setup: envelope did not encode');
    this.emit(encoded.value);
  }
}

let shouldFailStart = false;
let lastWorklet: FakeWorkletInstance | undefined;

interface FakeWorkletInstance {
  readonly IPC: FakeIpc;
  terminated: boolean;
  startedWith: { filename: string; source: unknown } | null;
}

class FakeWorklet implements FakeWorkletInstance {
  readonly IPC = new FakeIpc();
  terminated = false;
  startedWith: { filename: string; source: unknown } | null = null;

  constructor() {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- captures the constructed fake for the test to drive (no `startLane` return path exposes it otherwise)
    lastWorklet = this;
  }

  start(filename: string, source: unknown): void {
    if (shouldFailStart) throw new Error('worklet start failed (simulated)');
    this.startedWith = { filename, source };
  }

  terminate(): void {
    this.terminated = true;
  }
}

void mock.module('react-native-bare-kit', () => ({ Worklet: FakeWorklet }));
void mock.module('../../pear/worklet/dist/index.bundle.js', () => ({ default: 'fake-bundle-source' }));

let lane: typeof LaneModule;

beforeEach(async () => {
  shouldFailStart = false;
  lastWorklet = undefined;
  lane = await import('../../src/pear/lane');
});

/** The fake worklet `startLane()` most recently constructed. Every test in
 *  this file calls `startLane()` before touching this, so a thrown error
 *  here is a real test-setup bug, not a null case to swallow. */
function currentWorklet(): FakeWorkletInstance {
  if (!lastWorklet) throw new Error('startLane() was not called before accessing the fake worklet');
  return lastWorklet;
}

/** Decode every command `lane.ts` wrote to the fake IPC, in order. */
function writtenCommands(ipc: FakeIpc): Record<string, unknown>[] {
  const decoder = new FrameDecoder();
  const out: Record<string, unknown>[] = [];
  for (const chunk of ipc.written) {
    for (const event of decoder.push(chunk)) {
      if (event.kind === 'frame') out.push(event.value);
    }
  }
  return out;
}

describe('pear/lane — pearTopicFor', () => {
  it('is deterministic for the same DID', () => {
    const a = lane.pearTopicFor('did:key:z6MkfakeDidForTesting');
    const b = lane.pearTopicFor('did:key:z6MkfakeDidForTesting');
    expect(a).toBe(b);
  });

  it('differs across DIDs', () => {
    const a = lane.pearTopicFor('did:key:alice');
    const b = lane.pearTopicFor('did:key:bob');
    expect(a).not.toBe(b);
  });

  it('matches sha256("solidarity/pear/v1|" + did) hex, independently computed', () => {
    const did = 'did:key:z6MkExample';
    const expected = bytesToHex(sha256Bytes(`solidarity/pear/v1|${did}`));
    expect(lane.pearTopicFor(did)).toBe(expected);
  });

  it('produces a 32-byte (64 hex char) topic — hyperswarm topic length', () => {
    expect(lane.pearTopicFor('did:key:anything').length).toBe(64);
  });
});

describe('pear/lane — startLane', () => {
  it('returns ok(LaneHandle) and starts the worklet with the bundle at /app.bundle', () => {
    const result = lane.startLane();
    expect(result.ok).toBe(true);
    expect(lastWorklet?.startedWith).toEqual({ filename: '/app.bundle', source: 'fake-bundle-source' });
  });

  it('returns err when the worklet fails to start, without throwing', () => {
    shouldFailStart = true;
    const result = lane.startLane();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('worklet_start_failed');
  });

  it('shutdown() terminates the worklet', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    result.value.shutdown();
    expect(lastWorklet?.terminated).toBe(true);
  });
});

describe('pear/lane — joinTopic', () => {
  it('sends a _join command with the topic and default mode "both"', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    result.value.joinTopic('a'.repeat(64));

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands).toEqual([{ t: '_join', topic: 'a'.repeat(64), mode: 'both' }]);
  });

  it('honours an explicit mode', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    result.value.joinTopic('b'.repeat(64), 'client');

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands).toEqual([{ t: '_join', topic: 'b'.repeat(64), mode: 'client' }]);
  });

  it('connection(connId).send() sends a _send command carrying the topic, connId, and frame verbatim', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const channel = result.value.joinTopic('c'.repeat(64));
    channel.connection(1).send({ t: 'card.request' });

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands[1]).toEqual({ t: '_send', topic: 'c'.repeat(64), connId: 1, frame: { t: 'card.request' } });
  });

  it('channel.close() sends a _leave command', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const channel = result.value.joinTopic('d'.repeat(64));
    channel.close();

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands[1]).toEqual({ t: '_leave', topic: 'd'.repeat(64) });
  });

  it('connection(connId).close() sends a _closeConn command scoped to that connId only', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const channel = result.value.joinTopic('p'.repeat(64));
    channel.connection(7).close();

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands[1]).toEqual({ t: '_closeConn', topic: 'p'.repeat(64), connId: 7 });
  });

  it('routes a relayed _frame envelope to onFrame for the matching CONNECTION only — not merely the matching topic', () => {
    // SECURITY: this is the connection-scoping property the A5.2 fix
    // establishes. Two connections (1 and 2) open on the SAME topic — e.g.
    // the legitimate authenticated peer and an uninvited third party who
    // merely knows the topic (an unkeyed hash of the responder's own did,
    // per `pearTopicFor`'s doc) and joined it too. A frame tagged connId 2
    // must never reach connId 1's listeners, even though both are on the
    // one topic `lane.ts` sees.
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'a'.repeat(64);
    const channel = result.value.joinTopic(topic);
    const connA = channel.connection(1);
    const connB = channel.connection(2);

    const receivedA: Record<string, unknown>[] = [];
    const receivedB: Record<string, unknown>[] = [];
    connA.onFrame((f) => receivedA.push(f));
    connB.onFrame((f) => receivedB.push(f));

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'hello-a' } });

    expect(receivedA).toEqual([{ t: 'hello-a' }]);
    expect(receivedB).toEqual([]);
  });

  it('a _frame envelope with no connId is dropped (nothing safe to route it to)', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'q'.repeat(64);
    const channel = result.value.joinTopic(topic);
    const received: Record<string, unknown>[] = [];
    channel.connection(1).onFrame((f) => received.push(f));

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, frame: { t: 'no-connid' } });

    expect(received).toEqual([]);
  });

  it('routes a _ctrl envelope to onCtrl for the matching topic', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'e'.repeat(64);
    const channel = result.value.joinTopic(topic);

    const events: unknown[] = [];
    channel.onCtrl((ev) => events.push(ev));

    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'close', connId: 1 });

    expect(events).toEqual([
      { t: '_ctrl', topic, ev: 'open', connId: 1 },
      { t: '_ctrl', topic, ev: 'close', connId: 1 },
    ]);
  });

  it('routes a _ctrl envelope to connection(connId).onCtrl for the matching connId only', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'r'.repeat(64);
    const channel = result.value.joinTopic(topic);

    const eventsA: unknown[] = [];
    const eventsB: unknown[] = [];
    channel.connection(1).onCtrl((ev) => eventsA.push(ev));
    channel.connection(2).onCtrl((ev) => eventsB.push(ev));

    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'close', connId: 1 });

    expect(eventsA).toEqual([
      { t: '_ctrl', topic, ev: 'open', connId: 1 },
      { t: '_ctrl', topic, ev: 'close', connId: 1 },
    ]);
    // connId 2 never opened/closed — it must see NOTHING from connId 1's
    // lifecycle, even on the same topic.
    expect(eventsB).toEqual([]);
  });

  it('a topic-wide _ctrl error (no connId) still reaches every connection on that topic', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 's'.repeat(64);
    const channel = result.value.joinTopic(topic);
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });

    const events: unknown[] = [];
    channel.connection(1).onCtrl((ev) => events.push(ev));

    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'error', message: 'DHT bootstrap timed out' });

    expect(events.at(-1)).toEqual({ t: '_ctrl', topic, ev: 'error', message: 'DHT bootstrap timed out' });
  });

  it('a frame that arrives split across multiple IPC chunks still routes once complete', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'f'.repeat(64);
    const channel = result.value.joinTopic(topic);
    const received: Record<string, unknown>[] = [];
    channel.connection(1).onFrame((f) => received.push(f));

    const encoded = encodeFrame({ t: '_frame', topic, connId: 1, frame: { t: 'fragmented' } });
    if (!encoded.ok) throw new Error('setup failed');
    currentWorklet().IPC.emit(encoded.value.slice(0, 5));
    currentWorklet().IPC.emit(encoded.value.slice(5));

    expect(received).toEqual([{ t: 'fragmented' }]);
  });

  it('unsubscribe functions from onFrame/onCtrl stop further delivery', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'g'.repeat(64);
    const channel = result.value.joinTopic(topic);

    const received: Record<string, unknown>[] = [];
    const unsubscribe = channel.connection(1).onFrame((f) => received.push(f));
    unsubscribe();

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'should-not-arrive' } });
    expect(received).toEqual([]);
  });

  it('topic close() stops routing further frames for connections that were seen on that topic', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'h'.repeat(64);
    const channel = result.value.joinTopic(topic);
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });

    const received: Record<string, unknown>[] = [];
    channel.connection(1).onFrame((f) => received.push(f));
    channel.close();

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'after-close' } });
    expect(received).toEqual([]);
  });
});

// ── SECURITY: cross-connection attack repro (task A5.2 round 1) ────────────
//
// Permanent regression coverage for the connection-scoping fix. Mirrors
// EXACTLY the attack described in the task: `useReachableMode` opens a
// long-lived server on `pearTopicFor(myDid)` (an unkeyed, non-secret hash
// of the responder's own did); an uninvited third party who merely knows
// that did can join the same topic — no handshake required — and, pre-fix,
// have its raw frames delivered to whatever session was authenticated on a
// DIFFERENT connection, and receive a broadcast of that session's replies
// (e.g. a `card.offer`). This test drives the exact same stack a real
// responder uses (`joinTopic` -> per-connection `authenticateChannel` ->
// `createPearSession` -> `onCardRequest`) and asserts BOTH halves of the
// leak are closed: (1) an uninvited connection's `card.request` never
// reaches the OTHER connection's session/consent handler, and (2) that
// session's `card.offer` — sent in response to ITS OWN legitimate
// request — is never delivered to the uninvited connection.
//
// Against the pre-fix topic-scoped `PearChannel` (`.send`/`.onFrame` with
// no `connId`) this fails on both counts — see this task's round-1 report
// for the RED evidence captured against that code (recorded separately;
// the pre-fix API no longer exists to run it against once the fix lands).
describe('pear/lane — SECURITY: connection-scoping (cross-connection attack repro)', () => {
  it('GREEN: a card.offer sent by the session on connection A is never delivered to an uninvited connection B, and B\'s raw card.request never reaches A\'s consent handler', async () => {
    const { createPearSession } = await import('../../src/pear/protocol');

    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'n'.repeat(64);
    const channel = result.value.joinTopic(topic, 'server');

    // Connection A: the legitimate peer, completes the real mutual handshake.
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });
    const connA = channel.connection(1);
    const auth = authenticateChannel(connA, {
      myDid: ALICE_DID,
      peerDid: BOB_DID,
      signer: aliceSigner,
      handshakeTimeoutMs: 200,
    });

    await Promise.resolve();
    await Promise.resolve();
    const challengeCmd = writtenCommands(currentWorklet().IPC).find(
      (c) => c['t'] === '_send' && c['connId'] === 1 && (c['frame'] as Record<string, unknown> | undefined)?.['t'] === 'challenge'
    );
    const aliceChallenge = (challengeCmd?.['frame'] as { c: unknown }).c;

    const jwsFromBob = await respondChallenge(aliceChallenge as never, BOB_DID, bobSigner);
    // Bob's answer + his own challenge both arrive tagged connId: 1 — this
    // IS connection A's traffic.
    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'challenge.response', jws: jwsFromBob } });
    const bobChallenge = buildChallenge({
      requester: BOB_DID,
      subject: ALICE_DID,
      purpose: 'pear.card',
      nonce: randomChallengeNonce(),
      ts: Math.floor(Date.now() / 1000),
    });
    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'challenge', c: bobChallenge } });

    const authResult = await auth;
    expect(authResult.ok).toBe(true);
    if (!authResult.ok) return;

    const session = createPearSession(authResult.value);
    let cardRequestHandlerInvoked = 0;
    session.onCardRequest(async () => {
      cardRequestHandlerInvoked += 1;
      return { cardJws: 'fake-card-jws-for-routing-test' };
    });

    // Connection B: an uninvited third party joins the SAME topic (it only
    // needed the responder's did, per `pearTopicFor`'s doc) and — with NO
    // handshake at all — sends a raw card.request. (`connB.onFrame` is
    // deliberately NOT subscribed here to observe "what B receives" — it
    // would also observe the very frame this test injects AS COMING FROM
    // B below, which is a test-harness artifact, not a leak. Outbound
    // delivery to B is instead verified below by inspecting every `_send`
    // command's `connId`.)
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 2 });

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 2, frame: { t: 'card.request', reqId: 999 } });
    await Promise.resolve();

    // (1) B's request never reached A's session/consent handler.
    expect(cardRequestHandlerInvoked).toBe(0);

    // Now A (the real, authenticated peer) sends its OWN legitimate
    // card.request on connection A.
    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'card.request', reqId: 1 } });
    await Promise.resolve();
    expect(cardRequestHandlerInvoked).toBe(1);

    // (2) The resulting card.offer must be sent ONLY to connId 1 — never
    // broadcast, and specifically never addressed to connId 2 (B).
    const allSendCommands = writtenCommands(currentWorklet().IPC).filter((c) => c['t'] === '_send');
    const offerCommands = allSendCommands.filter(
      (c) => (c['frame'] as Record<string, unknown> | undefined)?.['t'] === 'card.offer'
    );
    expect(offerCommands).toHaveLength(1);
    expect(offerCommands[0]?.['connId']).toBe(1);
    // No `_send` command of ANY kind was ever targeted at connId 2 — the
    // uninvited connection never receives a single byte of session traffic.
    expect(allSendCommands.some((c) => c['connId'] === 2)).toBe(false);
  });
});

// Regression coverage for the structural fix to the open-event race
// documented in `lane.ts`'s `PearChannel.onCtrl` doc and `handshake.ts`'s
// module doc: `onCtrl` used to only deliver FUTURE `_ctrl` events, so a
// subscriber (e.g. `authenticateChannel`) that attached even one microtask
// after `open` fired would silently miss it and time out. `lane.ts` now
// retains the last `_ctrl` event per topic and replays it synchronously to
// a newly-attached `onCtrl` listener.
describe('pear/lane — onCtrl late-subscriber replay', () => {
  it('replays the last _ctrl event synchronously to a listener attached after it fired', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'i'.repeat(64);
    const channel = result.value.joinTopic(topic);

    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });

    // Nobody was listening when 'open' arrived — this is the late-attach case.
    const events: unknown[] = [];
    channel.onCtrl((ev) => events.push(ev));

    expect(events).toEqual([{ t: '_ctrl', topic, ev: 'open', connId: 1 }]);
  });

  it('does not re-deliver the replayed event to a listener that was already subscribed', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'j'.repeat(64);
    const channel = result.value.joinTopic(topic);

    const events: unknown[] = [];
    channel.onCtrl((ev) => events.push(ev)); // subscribed BEFORE 'open'
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });

    // Exactly one delivery (the live one) — no duplicate from replay logic.
    expect(events).toEqual([{ t: '_ctrl', topic, ev: 'open', connId: 1 }]);
  });

  it('a fresh joinTopic() on the same topic does not replay a previous connection\'s stale ctrl event', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'k'.repeat(64);
    const first = result.value.joinTopic(topic);
    currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });
    first.close();

    const second = result.value.joinTopic(topic);
    const events: unknown[] = [];
    second.onCtrl((ev) => events.push(ev));

    expect(events).toEqual([]);
  });

  it(
    'authenticateChannel still completes mutual authentication when it attaches onCtrl after ' +
      "'open' already fired (await gap between joinTopic and authenticateChannel)",
    async () => {
      // TEST-ONLY scalars — mirrors pearHandshake.test.ts's fixed-hex-scalar
      // convention.
      const ALICE_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i + 1) & 0xff);
      const ALICE_DID = didKeyFromPublicKey(publicKeyFromPrivate(ALICE_PRIV));
      const aliceSigner: Signer = async (digest) => p256.sign(digest, ALICE_PRIV, { prehash: false });

      const BOB_PRIV = new Uint8Array(32).fill(0).map((_, i) => (i * 7 + 3) & 0xff);
      const BOB_DID = didKeyFromPublicKey(publicKeyFromPrivate(BOB_PRIV));
      const bobSigner: Signer = async (digest) => p256.sign(digest, BOB_PRIV, { prehash: false });

      const result = lane.startLane();
      if (!result.ok) throw new Error('setup failed');
      const topic = 'l'.repeat(64);
      const channel = result.value.joinTopic(topic);

      // The worklet reports 'open' before anyone has called
      // `authenticateChannel` — exactly the race the structural fix covers.
      currentWorklet().IPC.emitEnvelope({ t: '_ctrl', topic, ev: 'open', connId: 1 });
      await Promise.resolve(); // the gap: at least one microtask between 'open' and subscribing

      // `channel.connection(1)` is constructed AFTER 'open' already fired —
      // it still observes it via the same per-connId replay buffer
      // `PearChannel.onCtrl` uses at the topic level (see `lane.ts`'s
      // `PearConnection.onCtrl` doc).
      const aliceAuth = authenticateChannel(channel.connection(1), {
        myDid: ALICE_DID,
        peerDid: BOB_DID,
        signer: aliceSigner,
        handshakeTimeoutMs: 200,
      });

      // Without the fix, `open` was dropped (no listeners existed when it
      // arrived) and `authenticateChannel`'s later `onCtrl` subscription has
      // no future 'open' to react to — Alice never sends a challenge and
      // `sentCommands` stays empty, so this lookup fails and the test times
      // out at `handshakeTimeoutMs`.
      const sentCommands = writtenCommands(currentWorklet().IPC);
      const challengeCmd = sentCommands.find(
        (c) => c['t'] === '_send' && c['connId'] === 1 && (c['frame'] as Record<string, unknown> | undefined)?.['t'] === 'challenge'
      );
      expect(challengeCmd).toBeDefined();
      const aliceChallenge = (challengeCmd?.['frame'] as { c: unknown }).c;

      // Bob answers Alice's challenge.
      const jwsFromBob = await respondChallenge(aliceChallenge as never, BOB_DID, bobSigner);
      currentWorklet().IPC.emitEnvelope({
        t: '_frame',
        topic,
        connId: 1,
        frame: { t: 'challenge.response', jws: jwsFromBob },
      });

      // Bob issues his own challenge to Alice, completing the mutual pair.
      const bobChallenge = buildChallenge({
        requester: BOB_DID,
        subject: ALICE_DID,
        purpose: 'pear.card',
        nonce: randomChallengeNonce(),
        ts: Math.floor(Date.now() / 1000),
      });
      currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, connId: 1, frame: { t: 'challenge', c: bobChallenge } });

      const aliceResult = await aliceAuth;
      expect(aliceResult.ok).toBe(true);
    }
  );
});
