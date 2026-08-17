/**
 * `src/pear/laneManager.ts` — get-or-create lane registry wired into
 * `lifecycle.ts`'s AppState hook. Mocks both `react-native-bare-kit`
 * (`lane.ts`'s dependency, mirrors `pearLane.test.ts`'s fake) and
 * `react-native` (`lifecycle.ts`'s dependency, mirrors
 * `pearLifecycle.test.ts`'s fake) since `laneManager.ts` sits directly on
 * top of both — see those files for the per-mock rationale, including the
 * "register the mock as close as possible to this file's own first import"
 * note on why `bun test`'s shared, whole-process module cache makes
 * ordering matter.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type * as LaneManagerModule from '../../src/pear/laneManager';
import type * as LifecycleModule from '../../src/pear/lifecycle';

class FakeIpc {
  private readonly handlers = new Set<(chunk: Uint8Array) => void>();
  on(event: string, cb: (chunk: Uint8Array) => void): this {
    if (event === 'data') this.handlers.add(cb);
    return this;
  }
  off(event: string, cb: (chunk: Uint8Array) => void): this {
    if (event === 'data') this.handlers.delete(cb);
    return this;
  }
  write(): void {
    // Nothing in this suite asserts on outbound worklet IPC bytes — that's
    // `pearLane.test.ts`'s job. `laneManager.ts` only cares about
    // start/terminate lifecycle.
  }
}

let shouldFailStart = false;
const instances: FakeWorkletInstance[] = [];

interface FakeWorkletInstance {
  readonly IPC: FakeIpc;
  terminated: boolean;
}

class FakeWorklet implements FakeWorkletInstance {
  readonly IPC = new FakeIpc();
  terminated = false;
  constructor() {
    instances.push(this);
  }
  start(): void {
    if (shouldFailStart) throw new Error('worklet start failed (simulated)');
  }
  terminate(): void {
    this.terminated = true;
  }
}

void mock.module('react-native-bare-kit', () => ({ Worklet: FakeWorklet }));
void mock.module('../../pear/worklet/dist/index.bundle.js', () => ({ default: 'fake-bundle-source' }));
void mock.module('react-native', () => ({
  ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
    .__AIRMEISHI_RN_MOCK__),
  AppState: {
    addEventListener: () => ({ remove: (): undefined => undefined }),
  },
}));

let laneManager: typeof LaneManagerModule;
let lifecycle: typeof LifecycleModule;

beforeAll(async () => {
  laneManager = await import('../../src/pear/laneManager');
  lifecycle = await import('../../src/pear/lifecycle');
});

beforeEach(() => {
  shouldFailStart = false;
  instances.length = 0;
  laneManager.stopLaneManager();
});

describe('pear/laneManager', () => {
  it('ensureLane creates a lane and lazily starts the lifecycle watcher', () => {
    expect(laneManager._testIsLaneManagerStarted()).toBe(false);

    const result = laneManager.ensureLane('a');

    expect(result.ok).toBe(true);
    expect(laneManager._testIsLaneManagerStarted()).toBe(true);
    expect(instances.length).toBe(1);
  });

  it('ensureLane is idempotent for the same id — same handle, no duplicate worklet', () => {
    const first = laneManager.ensureLane('a');
    const second = laneManager.ensureLane('a');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value).toBe(second.value);
    expect(instances.length).toBe(1);
  });

  it('ensureLane with a different id creates a distinct lane', () => {
    const a = laneManager.ensureLane('a');
    const b = laneManager.ensureLane('b');

    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value).not.toBe(b.value);
    expect(instances.length).toBe(2);
  });

  it('propagates a startLane failure without registering anything', () => {
    shouldFailStart = true;

    const result = laneManager.ensureLane('a');

    expect(result.ok).toBe(false);
    expect(laneManager.getLane('a')).toBeNull();
  });

  it('getLane returns null for an id that was never ensured', () => {
    expect(laneManager.getLane('nope')).toBeNull();
  });

  it('releaseLane shuts the worklet down and forgets the id', () => {
    const result = laneManager.ensureLane('a');
    if (!result.ok) throw new Error('setup failed');

    laneManager.releaseLane('a');

    expect(laneManager.getLane('a')).toBeNull();
    expect(instances[0]?.terminated).toBe(true);
  });

  it('releaseLane on an unknown id is a no-op', () => {
    expect(() => {
      laneManager.releaseLane('nope');
    }).not.toThrow();
  });

  it('a background AppState transition shuts down every ensured lane', () => {
    laneManager.ensureLane('a');
    laneManager.ensureLane('b');

    lifecycle._testHandleAppStateChange('background');

    expect(laneManager.getLane('a')).toBeNull();
    expect(laneManager.getLane('b')).toBeNull();
    expect(instances.every((w) => w.terminated)).toBe(true);
  });

  it('foreground after a background transition fires onForeground and clears bookkeeping', () => {
    let calls = 0;
    laneManager.startLaneManager({
      onForeground: () => {
        calls += 1;
      },
    });
    laneManager.ensureLane('a');

    lifecycle._testHandleAppStateChange('background');
    expect(calls).toBe(0);

    lifecycle._testHandleAppStateChange('active');
    expect(calls).toBe(1);
    expect(laneManager.getLane('a')).toBeNull();
  });

  it('startLaneManager is a no-op once already started — a later config is ignored', () => {
    let firstCalls = 0;
    let secondCalls = 0;
    laneManager.startLaneManager({
      onForeground: () => {
        firstCalls += 1;
      },
    });
    laneManager.startLaneManager({
      onForeground: () => {
        secondCalls += 1;
      },
    });

    lifecycle._testHandleAppStateChange('background');
    lifecycle._testHandleAppStateChange('active');

    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(0);
  });

  it('stopLaneManager tears down every lane and resets the started flag', () => {
    laneManager.ensureLane('a');

    laneManager.stopLaneManager();

    expect(laneManager._testIsLaneManagerStarted()).toBe(false);
    expect(laneManager.getLane('a')).toBeNull();
    expect(instances[0]?.terminated).toBe(true);
  });
});
