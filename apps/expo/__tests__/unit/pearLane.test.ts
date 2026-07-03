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

  it('channel.send() sends a _send command carrying the frame verbatim', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const channel = result.value.joinTopic('c'.repeat(64));
    channel.send({ t: 'card.request' });

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands[1]).toEqual({ t: '_send', topic: 'c'.repeat(64), frame: { t: 'card.request' } });
  });

  it('channel.close() sends a _leave command', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const channel = result.value.joinTopic('d'.repeat(64));
    channel.close();

    const commands = writtenCommands(currentWorklet().IPC);
    expect(commands[1]).toEqual({ t: '_leave', topic: 'd'.repeat(64) });
  });

  it('routes a relayed _frame envelope to onFrame for the matching topic only', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topicA = 'a'.repeat(64);
    const topicB = 'b'.repeat(64);
    const channelA = result.value.joinTopic(topicA);
    const channelB = result.value.joinTopic(topicB);

    const receivedA: Record<string, unknown>[] = [];
    const receivedB: Record<string, unknown>[] = [];
    channelA.onFrame((f) => receivedA.push(f));
    channelB.onFrame((f) => receivedB.push(f));

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic: topicA, frame: { t: 'hello-a' } });

    expect(receivedA).toEqual([{ t: 'hello-a' }]);
    expect(receivedB).toEqual([]);
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

  it('a frame that arrives split across multiple IPC chunks still routes once complete', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'f'.repeat(64);
    const channel = result.value.joinTopic(topic);
    const received: Record<string, unknown>[] = [];
    channel.onFrame((f) => received.push(f));

    const encoded = encodeFrame({ t: '_frame', topic, frame: { t: 'fragmented' } });
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
    const unsubscribe = channel.onFrame((f) => received.push(f));
    unsubscribe();

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, frame: { t: 'should-not-arrive' } });
    expect(received).toEqual([]);
  });

  it('close() stops routing further frames for that topic', () => {
    const result = lane.startLane();
    if (!result.ok) throw new Error('setup failed');
    const topic = 'h'.repeat(64);
    const channel = result.value.joinTopic(topic);
    const received: Record<string, unknown>[] = [];
    channel.onFrame((f) => received.push(f));
    channel.close();

    currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, frame: { t: 'after-close' } });
    expect(received).toEqual([]);
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

      const aliceAuth = authenticateChannel(channel, {
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
        (c) => c['t'] === '_send' && (c['frame'] as Record<string, unknown> | undefined)?.['t'] === 'challenge'
      );
      expect(challengeCmd).toBeDefined();
      const aliceChallenge = (challengeCmd?.['frame'] as { c: unknown }).c;

      // Bob answers Alice's challenge.
      const jwsFromBob = await respondChallenge(aliceChallenge as never, BOB_DID, bobSigner);
      currentWorklet().IPC.emitEnvelope({
        t: '_frame',
        topic,
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
      currentWorklet().IPC.emitEnvelope({ t: '_frame', topic, frame: { t: 'challenge', c: bobChallenge } });

      const aliceResult = await aliceAuth;
      expect(aliceResult.ok).toBe(true);
    }
  );
});
