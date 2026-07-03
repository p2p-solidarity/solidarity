/**
 * Pear lane lifecycle — AppState hook only (A3.2). Bare's worklet I/O
 * (hyperswarm sockets, the DHT) is not exempt from the OS's background
 * network suspension, so any live lane MUST stop before the app is fully
 * backgrounded or the OS force-terminates it mid-connection (same
 * constraint `docs/ref/04-plan-app.md` §A3.3 calls out for the real PoC).
 *
 * This module is deliberately mechanical:
 *   - background/inactive -> `lane.shutdown()` on every registered lane.
 *   - return to active (from background) -> fire `onForeground` once, so
 *     the caller can re-run `startLane` + `joinTopic` if it wants a lane
 *     back. We do NOT auto-restart lanes here — re-init policy (which
 *     topics, whether to prompt, backoff) is A3.3's job.
 *
 * Mirrors `src/vault/inactivityMonitor.ts`'s AppState pattern (module
 * singleton state + `_testHandleAppStateChange` test hook), since that's
 * the codebase's existing precedent for this exact kind of listener.
 */
import { AppState, type NativeEventSubscription } from 'react-native';

import type { LaneHandle } from './lane';

export interface PearLifecycleConfig {
  /** Fired once when the app returns to `active` after having been
   *  backgrounded — never fired on the initial `startPearLifecycle` call
   *  itself, since there was no prior background transition. */
  readonly onForeground?: () => void;
}

interface LifecycleState {
  subscription: NativeEventSubscription | null;
  lanes: Set<LaneHandle>;
  onForeground: (() => void) | null;
  wasBackground: boolean;
}

const state: LifecycleState = {
  subscription: null,
  lanes: new Set(),
  onForeground: null,
  wasBackground: false,
};

/** Register a lane so a background transition shuts it down. Returns an
 *  unregister function (call it from the lane's own teardown so lifecycle
 *  doesn't hold a dangling reference / double-shutdown). */
export function registerLane(lane: LaneHandle): () => void {
  state.lanes.add(lane);
  return () => {
    state.lanes.delete(lane);
  };
}

function shutdownAllLanes(): void {
  for (const lane of state.lanes) {
    try {
      lane.shutdown();
    } catch {
      // Already dead (e.g. worklet crashed before backgrounding) — nothing
      // left to clean up for this lane.
    }
  }
  state.lanes.clear();
}

function handleAppStateChange(next: string): void {
  if (next !== 'active') {
    state.wasBackground = true;
    shutdownAllLanes();
    return;
  }
  if (state.wasBackground) {
    state.wasBackground = false;
    state.onForeground?.();
  }
}

/** Begin observing AppState. Idempotent — calling again replaces the
 *  config and re-subscribes. */
export function startPearLifecycle(config?: PearLifecycleConfig): void {
  stopPearLifecycle();
  state.onForeground = config?.onForeground ?? null;
  state.wasBackground = false;
  state.subscription = AppState.addEventListener('change', handleAppStateChange);
}

/** Tear down the AppState observer. Does NOT shut down registered lanes —
 *  callers that want that should call `shutdownAllLanes` semantics via a
 *  real background transition, or shut lanes down explicitly themselves. */
export function stopPearLifecycle(): void {
  state.subscription?.remove();
  state.subscription = null;
  state.onForeground = null;
  state.lanes.clear();
}

/** Test-only — direct dispatch of an AppState change without RN. */
export function _testHandleAppStateChange(next: string): void {
  handleAppStateChange(next);
}
