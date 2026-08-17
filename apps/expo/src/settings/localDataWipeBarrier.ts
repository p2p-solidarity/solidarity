/**
 * Process-wide epoch used to quiesce asynchronous local-data writers while
 * the destructive wipe is in progress. A producer captures an epoch before
 * starting async work and must re-check it immediately before persistence.
 * Advancing the epoch makes every pre-wipe completion permanently stale.
 */
let epoch = 0;
let wipeInProgress = false;
const activeLocalDataOperations = new Set<Promise<unknown>>();

export type LocalDataEpoch = number;

export function captureLocalDataEpoch(): LocalDataEpoch {
  return epoch;
}

export function canCommitLocalData(capturedEpoch: LocalDataEpoch): boolean {
  return !wipeInProgress && capturedEpoch === epoch;
}

/**
 * Register an asynchronous writer whose final mutation is guarded by this
 * module's epoch. The wipe coordinator drains these operations before it
 * deletes files, so a native filesystem write already in flight cannot land
 * after the target directory has been removed.
 */
export function trackLocalDataOperation<T>(operation: Promise<T>): Promise<T> {
  activeLocalDataOperations.add(operation);
  const remove = (): void => {
    activeLocalDataOperations.delete(operation);
  };
  operation.then(remove, remove);
  return operation;
}

/** Wait for generic local-data writers to reach their final epoch check. */
export async function quiesceLocalDataOperations(): Promise<void> {
  while (activeLocalDataOperations.size > 0) {
    await Promise.allSettled([...activeLocalDataOperations]);
  }
}

/** Start (or retry) a wipe and invalidate every operation already in flight. */
export function beginLocalDataWipe(): void {
  epoch += 1;
  wipeInProgress = true;
}

/**
 * Re-enable new writes only after the full wipe, fresh MMKV key, and reset
 * preferences have all succeeded. Old epochs remain invalid forever.
 */
export function completeLocalDataWipe(): void {
  wipeInProgress = false;
}

export function isLocalDataWipeInProgress(): boolean {
  return wipeInProgress;
}

/** Test-only state reset. */
export function __resetLocalDataWipeBarrierForTesting(): void {
  epoch = 0;
  wipeInProgress = false;
  activeLocalDataOperations.clear();
}
