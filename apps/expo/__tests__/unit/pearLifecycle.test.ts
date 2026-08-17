/**
 * `src/pear/lifecycle.ts` — AppState -> lane shutdown/re-init hook.
 *
 * `react-native`'s AppState is a native module; we stub it the same way
 * `vaultShardDistribution.test.ts` stubs it for `inactivityMonitor.ts` —
 * `addEventListener` just needs to exist and return a `{remove}` handle,
 * and the module's own `_testHandleAppStateChange` hook drives the actual
 * transition so the test doesn't depend on RN's event dispatch.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type * as LifecycleModule from '../../src/pear/lifecycle';
import type { LaneHandle } from '../../src/pear/lane';

void mock.module('react-native', () => ({
  ...((globalThis as unknown as { __AIRMEISHI_RN_MOCK__: Record<string, unknown> })
    .__AIRMEISHI_RN_MOCK__),
  AppState: {
    addEventListener: () => ({ remove: (): undefined => undefined }),
  },
}));

let lifecycle: typeof LifecycleModule;

// Import once in `beforeAll` (mirrors `vaultShardDistribution.test.ts`'s
// proven-working pattern for `inactivityMonitor.ts`, which has the exact
// same `import { AppState } from 'react-native'` shape): `mock.module` is
// a global, last-registration-wins mock across the whole `bun test`
// process, so binding `lifecycle.ts`'s top-level `react-native` import as
// close as possible to this file's own `mock.module` call — rather than
// lazily on the first `beforeEach` — avoids racing a different test
// file's own `mock.module('react-native', ...)` call for who's "last"
// when the whole suite runs together.
beforeAll(async () => {
  lifecycle = await import('../../src/pear/lifecycle');
});

beforeEach(() => {
  lifecycle.stopPearLifecycle();
});

function fakeLane(): { handle: LaneHandle; shutdownCalls: number[] } {
  let calls = 0;
  const handle: LaneHandle = {
    joinTopic: () => {
      throw new Error('not used in this test');
    },
    shutdown: () => {
      calls += 1;
    },
  };
  return {
    handle,
    get shutdownCalls() {
      return [calls];
    },
  };
}

describe('pear/lifecycle', () => {
  it('shuts down every registered lane on background', () => {
    lifecycle.startPearLifecycle();
    const a = fakeLane();
    const b = fakeLane();
    lifecycle.registerLane(a.handle);
    lifecycle.registerLane(b.handle);

    lifecycle._testHandleAppStateChange('background');

    expect(a.shutdownCalls[0]).toBe(1);
    expect(b.shutdownCalls[0]).toBe(1);
  });

  it('shuts down lanes on inactive too, after the debounce grace elapses', async () => {
    lifecycle.startPearLifecycle({ inactiveGraceMs: 10 });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('inactive');
    // Still within the grace window — no shutdown yet.
    expect(a.shutdownCalls[0]).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(a.shutdownCalls[0]).toBe(1);
  });

  it('inactive -> active within the grace window cancels the pending shutdown', async () => {
    lifecycle.startPearLifecycle({ inactiveGraceMs: 10 });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('inactive');
    lifecycle._testHandleAppStateChange('active');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(a.shutdownCalls[0]).toBe(0);
  });

  it('inactive -> background during the grace window shuts down immediately, not after the grace delay', () => {
    lifecycle.startPearLifecycle({ inactiveGraceMs: 5000 });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('inactive');
    lifecycle._testHandleAppStateChange('background');

    // No await — background shutdown must be synchronous, not waiting on
    // the (much longer) inactive grace timer.
    expect(a.shutdownCalls[0]).toBe(1);
  });

  it('background is always immediate, with no grace period', () => {
    lifecycle.startPearLifecycle({ inactiveGraceMs: 5000 });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('background');

    expect(a.shutdownCalls[0]).toBe(1);
  });

  it('inactiveGraceMs: 0 shuts down synchronously on inactive (opt-out of debounce)', () => {
    lifecycle.startPearLifecycle({ inactiveGraceMs: 0 });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('inactive');

    expect(a.shutdownCalls[0]).toBe(1);
  });

  it('a repeated inactive transition restarts the debounce window instead of stacking timers', async () => {
    lifecycle.startPearLifecycle({ inactiveGraceMs: 20 });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('inactive');
    await new Promise((resolve) => setTimeout(resolve, 10));
    lifecycle._testHandleAppStateChange('inactive'); // restarts the 20ms window

    await new Promise((resolve) => setTimeout(resolve, 15));
    // 25ms since the first `inactive`, but only 15ms since the restart —
    // still pending.
    expect(a.shutdownCalls[0]).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(a.shutdownCalls[0]).toBe(1);
  });

  it('does not call shutdown when the app is already active (no-op transition)', () => {
    lifecycle.startPearLifecycle();
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('active');

    expect(a.shutdownCalls[0]).toBe(0);
  });

  it('fires onForeground exactly once when returning to active after a background transition', () => {
    let calls = 0;
    lifecycle.startPearLifecycle({ onForeground: () => { calls += 1; } });

    lifecycle._testHandleAppStateChange('background');
    expect(calls).toBe(0);

    lifecycle._testHandleAppStateChange('active');
    expect(calls).toBe(1);

    // A second `active` with no intervening background must not re-fire.
    lifecycle._testHandleAppStateChange('active');
    expect(calls).toBe(1);
  });

  it('does not fire onForeground on the very first active state (no prior background)', () => {
    let calls = 0;
    lifecycle.startPearLifecycle({ onForeground: () => { calls += 1; } });

    lifecycle._testHandleAppStateChange('active');

    expect(calls).toBe(0);
  });

  it('clears registered lanes after shutdownAllLanes so a stale handle is not double-shutdown', () => {
    lifecycle.startPearLifecycle();
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle._testHandleAppStateChange('background');
    lifecycle._testHandleAppStateChange('background');

    // Second background transition has nothing registered anymore.
    expect(a.shutdownCalls[0]).toBe(1);
  });

  it('unregisterLane removes a lane so it is not shut down on a later background', () => {
    lifecycle.startPearLifecycle();
    const a = fakeLane();
    const unregister = lifecycle.registerLane(a.handle);
    unregister();

    lifecycle._testHandleAppStateChange('background');

    expect(a.shutdownCalls[0]).toBe(0);
  });

  it('stopPearLifecycle clears config and registered lanes', () => {
    let calls = 0;
    lifecycle.startPearLifecycle({ onForeground: () => { calls += 1; } });
    const a = fakeLane();
    lifecycle.registerLane(a.handle);

    lifecycle.stopPearLifecycle();
    lifecycle._testHandleAppStateChange('background');
    lifecycle._testHandleAppStateChange('active');

    expect(a.shutdownCalls[0]).toBe(0);
    expect(calls).toBe(0);
  });
});
