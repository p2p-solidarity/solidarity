/** Backup, restore and sync must not race provider selection or local commits.
 *
 * Every entry is also BOUNDED. No native cloud call times out on its own, and
 * all three callers are tracked local-data work: one native promise that never
 * settles would hold this lock for the rest of the process — wedging backup,
 * restore and sync — and block "Delete all app data", which waits for tracked
 * operations to quiesce. A destructive request that silently never runs is
 * worse than one that fails, so the wait is capped rather than unbounded.
 * Every write past this point is epoch-guarded, so a late arrival cannot
 * commit against a wiped or re-identified store.
 */
const CLOUD_OPERATION_TIMEOUT_MS = 120_000;

let tail: Promise<unknown> = Promise.resolve();

function bounded<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('cloud-operation-timed-out')); }, timeoutMs);
    work().then(resolve, reject).finally(() => { clearTimeout(timer); });
  });
}

export function withCloudDataLock<T>(
  work: () => Promise<T>,
  timeoutMs: number = CLOUD_OPERATION_TIMEOUT_MS,
): Promise<T> {
  const run = (): Promise<T> => bounded(work, timeoutMs);
  const next = tail.then(run, run);
  tail = next.catch(() => undefined);
  return next;
}
