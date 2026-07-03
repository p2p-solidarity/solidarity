/**
 * Profile snapshots — local record of Verified Pages the user has scanned
 * and saved to People (1.3.3 Task A2.3, US-11: 「存入 People」).
 *
 * Deliberately a PARALLEL store, not folded into `src/contacts/repository.ts`:
 * a Profile Record (`displayName`/`bio`/`links`/`badges`, 01-spec §3) is a
 * structurally different shape from `Contact`'s BusinessCard-derived model
 * (`name`/`title`/`company`/`email`/`phone`/`sharingPreferences`/exchange
 * signatures/...). Mapping a scanned Profile Record into a `Contact` would
 * mean inventing fields no Verified Page carries (CLAUDE.md rule 8: no fake
 * data) just to satisfy a schema built for a different exchange flow.
 * Badge *verification* UI is a later task (A4+); this store only persists
 * what was actually verified today: the record, its signature, and when.
 *
 * Keyed by `did` — a Verified Page's one stable identity, and the natural
 * de-dupe key for "I already have this person" (re-scanning the same page
 * after they edited it should update the snapshot in place, not create a
 * second entry).
 *
 * Storage: same pattern as `src/profile/store.ts` (a single JSON blob under
 * one MMKV key via `getMmkv()`, which already opens the DB with an
 * encryption passphrase — see `storage/mmkv.ts`) rather than
 * `contacts/repository.ts`'s per-record-AES-GCM + manifest split. That
 * split exists to keep the FULL contacts list's cold-start decrypt cheap;
 * a user's set of saved Verified Pages has no equivalent frame-1 budget to
 * protect, so the simpler single-blob shape is the least-invasive choice.
 * Re-validated on every read via `parseProfile` — a hand-edited or
 * schema-drifted MMKV blob drops that one entry rather than corrupting the
 * whole store (matches `profile/store.ts`'s `readPersisted` policy).
 */
import { create } from 'zustand';

import { getMmkv } from '@/storage/mmkv';
import { parseProfile, type ProfileRecord } from '@solidarity/shared';

const KEY = 'profileSnapshots:v1';

export interface ProfileSnapshot {
  readonly did: string;
  readonly record: ProfileRecord;
  readonly jws: string;
  /** ISO timestamp of when THIS DEVICE last locally verified the page. */
  readonly verifiedAt: string;
}

interface PersistedSnapshot {
  readonly record: unknown;
  readonly jws: unknown;
  readonly verifiedAt: unknown;
}

function readPersisted(): ReadonlyMap<string, ProfileSnapshot> {
  const out = new Map<string, ProfileSnapshot>();
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, PersistedSnapshot>;
    for (const [did, entry] of Object.entries(parsed)) {
      if (typeof entry.jws !== 'string' || entry.jws.length === 0) continue;
      if (typeof entry.verifiedAt !== 'string' || entry.verifiedAt.length === 0) continue;
      const validated = parseProfile(entry.record);
      if (!validated.ok) continue;
      out.set(did, { did, record: validated.value, jws: entry.jws, verifiedAt: entry.verifiedAt });
    }
  } catch {
    // Corrupt MMKV blob — fail closed to an empty snapshot set.
  }
  return out;
}

function writePersisted(snapshots: ReadonlyMap<string, ProfileSnapshot>): void {
  try {
    const plain: Record<string, PersistedSnapshot> = {};
    for (const [did, snapshot] of snapshots) {
      plain[did] = { record: snapshot.record, jws: snapshot.jws, verifiedAt: snapshot.verifiedAt };
    }
    getMmkv().set(KEY, JSON.stringify(plain));
  } catch {
    // MMKV not ready / disk full — in-memory state (set right after this
    // call) still reflects the save for the current session, matching
    // profile/store.ts's writePersisted policy.
  }
}

interface ProfileSnapshotState {
  readonly snapshots: ReadonlyMap<string, ProfileSnapshot>;
  /** Insert-or-replace by `record.did`. Always a fresh `verifiedAt` — this
   * device just re-verified the page, even if the record content is
   * unchanged from a previous scan. */
  readonly upsert: (record: ProfileRecord, jws: string) => ProfileSnapshot;
}

export const useProfileSnapshotStore = create<ProfileSnapshotState>((set, get) => ({
  snapshots: new Map(),

  upsert: (record, jws) => {
    const snapshot: ProfileSnapshot = {
      did: record.did,
      record,
      jws,
      verifiedAt: new Date().toISOString(),
    };
    const next = new Map(get().snapshots);
    next.set(record.did, snapshot);
    writePersisted(next);
    set({ snapshots: next });
    return snapshot;
  },
}));

/** Swap in the persisted snapshot set from MMKV. Call once from the root
 * layout after `initMmkv()` resolves — mirrors `hydrateProfile()`. */
export function hydrateProfileSnapshots(): void {
  const persisted = readPersisted();
  if (persisted.size > 0) useProfileSnapshotStore.setState({ snapshots: persisted });
}

export function getProfileSnapshot(did: string): ProfileSnapshot | undefined {
  return useProfileSnapshotStore.getState().snapshots.get(did);
}

export const useProfileSnapshot = (did: string | undefined): ProfileSnapshot | undefined =>
  useProfileSnapshotStore((s) => (did ? s.snapshots.get(did) : undefined));
