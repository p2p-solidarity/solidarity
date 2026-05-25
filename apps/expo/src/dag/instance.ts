/**
 * DAG store singleton — the one MMKV-backed store every sandbox Lab
 * shares. Append a node in DAG Lab → see it in Identity Tree → publish
 * it from Nostr Bridge → intersect with a peer in Common Friends. One
 * persistent store across screens.
 *
 * Lazy creation: the singleton is constructed on first access. MMKV
 * may not be ready yet (cold start before app/_layout.tsx finishes
 * initMmkv), so `MmkvDagBackend` itself swallows errors and returns
 * empty/no-op; the store works without persistence until MMKV catches
 * up. Sandbox-acceptable.
 */
import { type DagStore, createDagStore } from './store';
import { MmkvDagBackend } from './storeMmkv';

let cached: DagStore | null = null;

/** The shared sandbox DAG store. Same instance on every call. */
export function getDagStore(): DagStore {
  if (!cached) {
    cached = createDagStore(new MmkvDagBackend());
  }
  return cached;
}

/** Test-only: reset the singleton so suites start isolated. */
export function _resetDagStoreSingletonForTests(): void {
  cached = null;
}
