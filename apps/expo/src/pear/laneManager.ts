/**
 * Pear lane manager — the singleton screens use instead of calling
 * `startLane`/`registerLane`/`startPearLifecycle` directly (A3.3). Owns the
 * mapping from a caller-chosen lane id (e.g. one id per role in a
 * multi-lane dev lab, or a single fixed id for the one real lane a
 * production screen ever needs) to its live `LaneHandle`, and wires every
 * lane it creates into `lifecycle.ts`'s AppState hook so screens don't have
 * to duplicate that plumbing at each call site.
 *
 * One AppState subscription for the whole app (same constraint
 * `lifecycle.ts` already documents): `startLaneManager` is a no-op if the
 * watcher is already running, so the FIRST caller's config wins for the
 * process lifetime. A caller that wants a different `inactiveGraceMs` /
 * `onForeground` must `stopLaneManager()` first.
 *
 * `ensureLane` lazily calls `startLaneManager()` with defaults if nothing
 * has started the watcher yet, so a caller that doesn't care about
 * `onForeground` can just call `ensureLane` directly.
 *
 * Every `LaneHandle` this module hands out wraps the real one so
 * `shutdown()` self-cleans this manager's bookkeeping NO MATTER WHO calls
 * it: `releaseLane`/`stopLaneManager` below, OR `lifecycle.ts`'s own
 * background-transition sweep, which calls `LaneHandle.shutdown()` directly
 * on every registered lane and has no idea this manager's `lanes` map
 * exists. Without that, a lane killed by backgrounding would stay "live" in
 * `getLane` until the NEXT foreground event clears everything in bulk —
 * `getLane` mid-background would hand back a handle to an already-dead
 * worklet. There is no auto-reconnect: a caller that wants a lane back
 * after foregrounding calls `ensureLane` again.
 */
import { ok, type Result } from '@solidarity/shared';

import { startLane, type LaneError, type LaneHandle } from './lane';
import { registerLane, startPearLifecycle, stopPearLifecycle, type PearLifecycleConfig } from './lifecycle';

interface ManagedLane {
  readonly handle: LaneHandle;
}

const lanes = new Map<string, ManagedLane>();
let started = false;

/**
 * Start the shared AppState lifecycle watcher. Idempotent — a second call
 * while already started is a no-op (see module doc); call `stopLaneManager`
 * first to reconfigure.
 */
export function startLaneManager(config?: PearLifecycleConfig): void {
  if (started) return;
  started = true;
  startPearLifecycle({
    inactiveGraceMs: config?.inactiveGraceMs,
    onForeground: () => {
      // Belt-and-suspenders: every lane that was actually live at
      // background time already deleted itself from `lanes` via its own
      // wrapped `shutdown()` (see module doc) — this just catches anything
      // that somehow didn't (there shouldn't be any).
      lanes.clear();
      config?.onForeground?.();
    },
  });
}

/**
 * Get-or-create the lane for `id`. Returns the existing handle if one is
 * already live for this id — idempotent, safe to call on every
 * render/mount without spawning duplicate worklets. Lazily starts the
 * lifecycle watcher with defaults if nothing has called `startLaneManager`
 * yet.
 */
export function ensureLane(id: string): Result<LaneHandle, LaneError> {
  startLaneManager();

  const existing = lanes.get(id);
  if (existing) return ok(existing.handle);

  const startResult = startLane();
  if (!startResult.ok) return startResult;
  const real = startResult.value;

  let unregisterFromLifecycle: (() => void) | null = null;

  const wrapped: LaneHandle = {
    joinTopic: (topicHex, mode) => real.joinTopic(topicHex, mode),
    shutdown: () => {
      lanes.delete(id);
      unregisterFromLifecycle?.();
      real.shutdown();
    },
  };

  unregisterFromLifecycle = registerLane(wrapped);
  lanes.set(id, { handle: wrapped });
  return ok(wrapped);
}

/** Read-only lookup — `null` if `id` has no live lane (never started, or
 *  already released/shut down by a background transition). */
export function getLane(id: string): LaneHandle | null {
  return lanes.get(id)?.handle ?? null;
}

/** Explicitly tear down one lane. No-op if `id` has no live lane. */
export function releaseLane(id: string): void {
  const existing = lanes.get(id);
  if (!existing) return;
  try {
    existing.handle.shutdown();
  } catch {
    // Already dead — nothing left to clean up.
  }
}

/**
 * Tear down every lane this manager owns and stop the lifecycle watcher.
 * For tests / full explicit teardown — NOT part of the normal background
 * flow (that's `lifecycle.ts`'s job, already wired via `startLaneManager`).
 */
export function stopLaneManager(): void {
  for (const managed of lanes.values()) {
    try {
      managed.handle.shutdown();
    } catch {
      // Already dead — nothing left to clean up.
    }
  }
  lanes.clear();
  stopPearLifecycle();
  started = false;
}

/** Test-only — whether `startLaneManager` has run without a matching
 *  `stopLaneManager`. */
export function _testIsLaneManagerStarted(): boolean {
  return started;
}
