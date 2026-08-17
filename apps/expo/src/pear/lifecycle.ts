/**
 * Pear lane lifecycle — AppState hook only (A3.2, debounce added A3.3).
 * Bare's worklet I/O (hyperswarm sockets, the DHT) is not exempt from the
 * OS's background network suspension, so any live lane MUST stop before the
 * app is fully backgrounded or the OS force-terminates it mid-connection
 * (same constraint `docs/ref/04-plan-app.md` §A3.3 calls out for the real
 * PoC).
 *
 * This module is deliberately mechanical:
 *   - `background` -> `lane.shutdown()` on every registered lane,
 *     IMMEDIATELY — the OS has already committed to backgrounding, so
 *     there's nothing to gain by waiting and every extra millisecond of
 *     open sockets risks a force-terminate mid-write.
 *   - `inactive` -> the same shutdown, but only after `inactiveGraceMs`
 *     (default 2000ms) of STILL being non-active. iOS routes through
 *     `inactive` for transient interruptions that never actually background
 *     the app — the app-switcher card preview, Control Center, a Face ID /
 *     system-alert sheet — and a live lane would otherwise be torn down and
 *     have to fully reconnect (fresh DHT lookup + Noise handshake) for
 *     something the user perceives as never having left the screen. A
 *     transition straight to `active` within the grace window cancels the
 *     pending shutdown with no lane disruption; a transition to
 *     `background` during the grace window shuts down immediately (per the
 *     rule above) and cancels the now-redundant pending timer.
 *   - return to `active` (after a shutdown actually ran) -> fire
 *     `onForeground` once, so the caller can re-run `startLane` +
 *     `joinTopic` if it wants a lane back. We do NOT auto-restart lanes
 *     here — re-init policy (which topics, whether to prompt, backoff) is
 *     the caller's job.
 *
 * Mirrors `src/vault/inactivityMonitor.ts`'s AppState pattern (module
 * singleton state + `_testHandleAppStateChange` test hook), since that's
 * the codebase's existing precedent for this exact kind of listener.
 */
import { AppState, type NativeEventSubscription } from 'react-native';

import type { LaneHandle } from './lane';

/** Default grace window before an `inactive` transition commits to a
 *  shutdown — see module doc. */
export const DEFAULT_INACTIVE_GRACE_MS = 2000;

export interface PearLifecycleConfig {
  /** Fired once when the app returns to `active` after having been
   *  backgrounded — never fired on the initial `startPearLifecycle` call
   *  itself, since there was no prior background transition, and never
   *  fired for an `inactive` blip that was cancelled before its grace
   *  window elapsed (no shutdown ran, so there's nothing to recover from). */
  readonly onForeground?: () => void;
  /** Debounce (ms) before an `inactive` transition shuts lanes down — see
   *  module doc. Default `DEFAULT_INACTIVE_GRACE_MS`. Pass `0` to shut down
   *  synchronously on `inactive` too (matches A3.2's original behaviour;
   *  mainly useful for tests that don't want to await the timer). */
  readonly inactiveGraceMs?: number;
}

interface LifecycleState {
  subscription: NativeEventSubscription | null;
  lanes: Set<LaneHandle>;
  onForeground: (() => void) | null;
  wasBackground: boolean;
  inactiveGraceMs: number;
  inactiveTimer: ReturnType<typeof setTimeout> | null;
}

const state: LifecycleState = {
  subscription: null,
  lanes: new Set(),
  onForeground: null,
  wasBackground: false,
  inactiveGraceMs: DEFAULT_INACTIVE_GRACE_MS,
  inactiveTimer: null,
};

function clearInactiveTimer(): void {
  if (state.inactiveTimer !== null) {
    clearTimeout(state.inactiveTimer);
    state.inactiveTimer = null;
  }
}

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

function commitShutdown(): void {
  state.inactiveTimer = null;
  state.wasBackground = true;
  shutdownAllLanes();
}

function handleAppStateChange(next: string): void {
  if (next === 'active') {
    // Returning to active always cancels a pending debounced shutdown —
    // whatever caused the `inactive` blip resolved before it committed.
    clearInactiveTimer();
    if (state.wasBackground) {
      state.wasBackground = false;
      state.onForeground?.();
    }
    return;
  }

  if (next === 'background') {
    // Already committed to backgrounding — no grace, see module doc.
    clearInactiveTimer();
    commitShutdown();
    return;
  }

  // `inactive` (or any other non-active/background AppState value) —
  // debounce. Re-arming on a repeated `inactive` restarts the window rather
  // than stacking timers.
  clearInactiveTimer();
  if (state.inactiveGraceMs <= 0) {
    commitShutdown();
    return;
  }
  state.inactiveTimer = setTimeout(commitShutdown, state.inactiveGraceMs);
}

/** Begin observing AppState. Idempotent — calling again replaces the
 *  config and re-subscribes. */
export function startPearLifecycle(config?: PearLifecycleConfig): void {
  stopPearLifecycle();
  state.onForeground = config?.onForeground ?? null;
  state.wasBackground = false;
  state.inactiveGraceMs = config?.inactiveGraceMs ?? DEFAULT_INACTIVE_GRACE_MS;
  state.subscription = AppState.addEventListener('change', handleAppStateChange);
}

/** Tear down the AppState observer. Does NOT shut down registered lanes —
 *  callers that want that should call `shutdownAllLanes` semantics via a
 *  real background transition, or shut lanes down explicitly themselves. */
export function stopPearLifecycle(): void {
  clearInactiveTimer();
  state.subscription?.remove();
  state.subscription = null;
  state.onForeground = null;
  state.lanes.clear();
}

/** Test-only — direct dispatch of an AppState change without RN. */
export function _testHandleAppStateChange(next: string): void {
  handleAppStateChange(next);
}
