/**
 * Durable bookkeeping for the automatic backup schedule.
 *
 * Two facts have to survive an app restart, and neither belongs in
 * `usePreferences` (they are recorded state, not user choices):
 *
 *  - `lastArchiveAtMs` — when the newest archive was actually written. The
 *    old in-memory `lastBackupAtMs` reset to null on every launch, so a
 *    6-hour schedule enforced with it would fire again on every cold start.
 *  - `digest` — a hash of the portable records that archive contains. With
 *    only three retained archives, re-uploading an unchanged snapshot every
 *    interval would evict the user's real restore points in favour of three
 *    identical files. Comparing digests means an automatic backup writes only
 *    when there is genuinely something new to save.
 *
 * The MMKV key is deliberately outside `isPortableStorageKey`, so writing it
 * never looks like a local edit to the sync engine's change listener.
 */
import { bytesToHex, sha256Bytes, stableJSON } from '@solidarity/shared';

import { getMmkv } from '../storage/mmkv';
import type { PortableData } from './portableData';

const KEY = 'backup:auto-state:v1';

export interface AutoBackupState {
  readonly lastArchiveAtMs: number | null;
  readonly digest: string | null;
}

const EMPTY: AutoBackupState = { lastArchiveAtMs: null, digest: null };

/**
 * Drop the fields that change without the user changing anything.
 *
 * `verifiedAt` on a Verified Page snapshot is a DEVICE-LOCAL observation —
 * "when we last re-checked this page" — not content. The contact auto-refresh
 * sweep re-resolves every saved page on a schedule and, when the signed bytes
 * come back identical, still refreshes `verifiedAt`
 * (`people/profileSnapshots.ts` → `alreadyCurrent`) and rewrites
 * `profileSnapshots:v1`. Digesting it verbatim made the change check fire on
 * every sweep for anyone with a saved Verified Page, which would write an
 * archive every interval forever and roll the three retained restore points
 * on a timer instead of on real edits.
 *
 * `jws` is deliberately KEPT: a different signature means the peer really did
 * republish, which is content worth a new archive. Only the archive's change
 * DETECTION ignores `verifiedAt` — the archive itself still stores it.
 */
function withoutVolatileFields(key: string, serialized: string): string {
  if (!key.startsWith('snapshot:')) return serialized;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return serialized;
    const strip = (value: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'verifiedAt'));
    const entry = strip(parsed as Record<string, unknown>);
    const conflicts = entry['conflicts'];
    if (Array.isArray(conflicts)) {
      entry['conflicts'] = conflicts.map((conflict: unknown) =>
        conflict !== null && typeof conflict === 'object' && !Array.isArray(conflict)
          ? strip(conflict as Record<string, unknown>)
          : conflict);
    }
    return stableJSON(entry);
  } catch {
    // An unparseable record still has to hash to something stable; hashing the
    // raw string is worse than nothing only in that it may churn — which is
    // the fail-open direction (an extra archive, never a missed one).
    return serialized;
  }
}

/** Content hash of the records an archive carries, ignoring device-local
 *  bookkeeping. Uses `stableJSON` so key order can never make an unchanged
 *  snapshot look different. */
export function portableDataDigest(data: PortableData): string {
  const stable = Object.fromEntries(
    Object.entries(data.records).map(([key, value]) => [key, withoutVolatileFields(key, value)]),
  );
  return bytesToHex(sha256Bytes(new TextEncoder().encode(stableJSON(stable))));
}

/**
 * Read the recorded state. An unreadable or malformed value degrades to
 * "nothing recorded" — which makes the next automatic backup run. Failing
 * open is the honest direction here: the cost is one extra archive, whereas
 * failing closed would silently stop backing the user up.
 */
export function readAutoBackupState(): AutoBackupState {
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY;
    const record = parsed as Record<string, unknown>;
    const at = record['lastArchiveAtMs'];
    const digest = record['digest'];
    return {
      lastArchiveAtMs: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null,
      digest: typeof digest === 'string' && /^[0-9a-f]{64}$/u.test(digest) ? digest : null,
    };
  } catch {
    return EMPTY;
  }
}

/** Record a successful archive. Best-effort: a storage failure must not turn
 *  a backup that DID reach the cloud into a reported failure. */
export function writeAutoBackupState(state: AutoBackupState): void {
  try {
    getMmkv().set(KEY, JSON.stringify(state));
  } catch {
    // Losing the marker only costs one redundant archive next interval.
  }
}
