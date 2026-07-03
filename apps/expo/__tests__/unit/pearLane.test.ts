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

import { bytesToHex, sha256Bytes } from '@solidarity/shared';

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
