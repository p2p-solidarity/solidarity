/**
 * Profile snapshots — local record of pages the user has scanned/verified
 * or imported and saved to People.
 *
 * Two kinds, one store (1.3.3 Task A2.4, US-19 fast-follow to A2.3):
 *   - `kind: 'verified'` — a Verified Page the device cryptographically
 *     checked itself (record + jws + `verifiedAt`), scanned via the Verify
 *     tab (Task A2.3, commit 1afb4a2). Keyed by `did`, its one stable
 *     identity — the natural de-dupe key for "I already have this person".
 *   - `kind: 'declared'` — a plaintext link page (Linktree or similar) the
 *     user pasted a URL for (`src/profile/linktreeImport.ts`). There is NO
 *     did, NO signature, NO cryptographic verification of any kind — just
 *     "this person told us this page is theirs". Never rendered with a
 *     verified indicator (CLAUDE.md rule 8); keyed by `stableDeclaredId
 *     (sourceUrl)` since there's no did to key on. Re-pasting the same URL
 *     upserts in place rather than duplicating.
 *
 * A legacy persisted entry with no `kind` field at all (written before this
 * task) is read as `'verified'` — see `readPersisted`'s back-compat branch,
 * pinned by `profileSnapshots.test.ts`'s "legacy shape" describe block.
 *
 * Deliberately a PARALLEL store, not folded into `src/contacts/repository.ts`:
 * a Profile Record (`displayName`/`bio`/`links`/`badges`, 01-spec §3) is a
 * structurally different shape from `Contact`'s BusinessCard-derived model
 * (`name`/`title`/`company`/`email`/`phone`/`sharingPreferences`/exchange
 * signatures/...). Mapping a scanned Profile Record into a `Contact` would
 * mean inventing fields no Verified Page carries (CLAUDE.md rule 8: no fake
 * data) just to satisfy a schema built for a different exchange flow. A
 * declared link-page snapshot is even further from a `Contact` — it isn't
 * even a full Profile Record. Badge *verification* UI is a later task
 * (A4+); this store only persists what was actually verified/declared
 * today: the record (or link list) and when.
 *
 * Storage: same pattern as `src/profile/store.ts` (a single JSON blob under
 * one MMKV key via `getMmkv()`, which already opens the DB with an
 * encryption passphrase — see `storage/mmkv.ts`) rather than
 * `contacts/repository.ts`'s per-record-AES-GCM + manifest split. That
 * split exists to keep the FULL contacts list's cold-start decrypt cheap;
 * a user's set of saved pages has no equivalent frame-1 budget to protect,
 * so the simpler single-blob shape is the least-invasive choice. Both maps
 * share ONE `Map<string, ProfileSnapshot>` keyed by whichever id applies
 * (did or declared id) — collision between a `did:key:…` string and a
 * lowercase-hex declared id is not a realistic concern.
 * Re-validated on every read via `parseProfile` / `profileLinkSchema` — a
 * hand-edited or schema-drifted MMKV blob drops that one entry rather than
 * corrupting the whole store (matches `profile/store.ts`'s `readPersisted`
 * policy).
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { z } from 'zod';

import { getMmkv } from '@/storage/mmkv';
import {
  bytesToHex,
  parseProfile,
  profileLinkSchema,
  sha256Bytes,
  type ProfileLink,
  type ProfileRecord,
} from '@solidarity/shared';

const KEY = 'profileSnapshots:v1';

export interface VerifiedSnapshot {
  readonly kind: 'verified';
  readonly did: string;
  readonly record: ProfileRecord;
  readonly jws: string;
  /** ISO timestamp of when THIS DEVICE last locally verified the page. */
  readonly verifiedAt: string;
}

export interface DeclaredSnapshot {
  readonly kind: 'declared';
  /** `stableDeclaredId(sourceUrl)` — the Map key and the `/people/declared/[id]` route param. */
  readonly id: string;
  /** Always null — a declared entry has no did; never fabricate one. */
  readonly did: null;
  readonly sourceUrl: string;
  readonly title: string | null;
  readonly links: readonly ProfileLink[];
  /** ISO timestamp of when THIS DEVICE last imported the page. */
  readonly importedAt: string;
}

export type ProfileSnapshot = VerifiedSnapshot | DeclaredSnapshot;

/** Normalizes a source URL before it's hashed by `stableDeclaredId`, so
 * trivially-equivalent URLs a user might paste for the "same" page all
 * resolve to the same declared id instead of silently duplicating:
 *   - scheme + host lowercased (`HTTPS://Linktr.EE/…` === `https://linktr.ee/…`)
 *   - a single trailing slash on the path stripped (`/alice/` === `/alice`)
 *   - the fragment dropped (`#section` is a client-side scroll target, not
 *     part of what the server serves)
 *
 * The query string is deliberately KEPT significant — `?tab=2` can be a
 * genuinely different page (a different Linktree tab, a paginated view,
 * etc.), and collapsing it would risk two different real pages silently
 * overwriting one another in the declared store. Unlike the fragment, the
 * server sees the query string, so "same URL" can't be assumed without it.
 *
 * Falls back to the trimmed raw string (never throws) when `URL` can't
 * parse the input — `stableDeclaredId` must still produce SOME deterministic
 * id for a malformed paste rather than blowing up the caller.
 *
 * Migration note: this only changes the id computed for URLs normalized
 * from now on. Any `DeclaredSnapshot` already persisted under the OLD
 * (un-normalized) id keeps that id — there is no migration pass over
 * existing MMKV entries, and none is needed: the entry is still valid and
 * still reachable at its existing `/people/declared/[id]` route. The only
 * user-visible effect is that re-pasting the exact same URL in a
 * differently-cased/slashed/fragmented form will, going forward, dedupe
 * against the NEW id rather than the old one — a one-time, harmless quirk
 * for anyone who re-imports a page they'd already saved before this fix.
 */
function normalizeForHashing(sourceUrl: string): string {
  const trimmed = sourceUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const scheme = parsed.protocol.toLowerCase();
    const host = parsed.host.toLowerCase();
    const path =
      parsed.pathname.length > 1 && parsed.pathname.endsWith('/')
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname;
    return `${scheme}//${host}${path}${parsed.search}`;
  } catch {
    return trimmed;
  }
}

/** Stable, non-secret id for a declared entry — first 24 hex chars of
 * SHA-256(normalizeForHashing(sourceUrl)). Deterministic so re-pasting the
 * same (or trivially-equivalent, see `normalizeForHashing`) URL always
 * resolves to the same Map key / route param (upsert-in-place, not a
 * duplicate), without needing to persist a separately-generated uuid. */
export function stableDeclaredId(sourceUrl: string): string {
  return bytesToHex(sha256Bytes(normalizeForHashing(sourceUrl))).slice(0, 24);
}

const declaredLinksSchema = z.array(profileLinkSchema);

interface PersistedVerifiedEntry {
  readonly kind?: 'verified'; // absent on entries persisted before this task — back-compat
  readonly record: unknown;
  readonly jws: unknown;
  readonly verifiedAt: unknown;
}

interface PersistedDeclaredEntry {
  readonly kind: 'declared';
  readonly sourceUrl: unknown;
  readonly title: unknown;
  readonly links: unknown;
  readonly importedAt: unknown;
}

type PersistedEntry = PersistedVerifiedEntry | PersistedDeclaredEntry;

function isPersistedDeclared(entry: PersistedEntry): entry is PersistedDeclaredEntry {
  return entry.kind === 'declared';
}

function readPersisted(): ReadonlyMap<string, ProfileSnapshot> {
  const out = new Map<string, ProfileSnapshot>();
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return out;
    // Typed `unknown` (not `Record<string, PersistedEntry>`) so the
    // null/object runtime guard below is real, not a type-narrowed no-op —
    // `JSON.parse` on an untrusted persisted blob can hand back anything,
    // regardless of what we assert its shape to be.
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [key, rawEntry] of Object.entries(parsed)) {
      if (rawEntry === null || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as PersistedEntry;

      if (isPersistedDeclared(entry)) {
        if (typeof entry.sourceUrl !== 'string' || entry.sourceUrl.length === 0) continue;
        if (typeof entry.importedAt !== 'string' || entry.importedAt.length === 0) continue;
        const linksResult = declaredLinksSchema.safeParse(entry.links);
        if (!linksResult.success) continue;
        const title = typeof entry.title === 'string' ? entry.title : null;
        out.set(key, {
          kind: 'declared',
          id: key,
          did: null,
          sourceUrl: entry.sourceUrl,
          title,
          links: linksResult.data,
          importedAt: entry.importedAt,
        });
        continue;
      }

      // No `kind`, or explicit `kind: 'verified'` — identical validation
      // path either way, so a legacy (pre-A2.4) blob hydrates unchanged.
      if (typeof entry.jws !== 'string' || entry.jws.length === 0) continue;
      if (typeof entry.verifiedAt !== 'string' || entry.verifiedAt.length === 0) continue;
      const validated = parseProfile(entry.record);
      if (!validated.ok) continue;
      out.set(key, {
        kind: 'verified',
        did: validated.value.did,
        record: validated.value,
        jws: entry.jws,
        verifiedAt: entry.verifiedAt,
      });
    }
  } catch {
    // Corrupt MMKV blob — fail closed to an empty snapshot set.
  }
  return out;
}

function writePersisted(snapshots: ReadonlyMap<string, ProfileSnapshot>): void {
  try {
    const plain: Record<string, unknown> = {};
    for (const [key, snapshot] of snapshots) {
      plain[key] =
        snapshot.kind === 'verified'
          ? { kind: 'verified', record: snapshot.record, jws: snapshot.jws, verifiedAt: snapshot.verifiedAt }
          : {
              kind: 'declared',
              sourceUrl: snapshot.sourceUrl,
              title: snapshot.title,
              links: snapshot.links,
              importedAt: snapshot.importedAt,
            };
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
  readonly upsert: (record: ProfileRecord, jws: string) => VerifiedSnapshot;
  /** Insert-or-replace by `stableDeclaredId(sourceUrl)` — re-pasting the
   * same link page updates the saved link list rather than duplicating. */
  readonly upsertDeclared: (
    sourceUrl: string,
    title: string | null,
    links: readonly ProfileLink[]
  ) => DeclaredSnapshot;
}

export const useProfileSnapshotStore = create<ProfileSnapshotState>((set, get) => ({
  snapshots: new Map(),

  upsert: (record, jws) => {
    const snapshot: VerifiedSnapshot = {
      kind: 'verified',
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

  upsertDeclared: (sourceUrl, title, links) => {
    const id = stableDeclaredId(sourceUrl);
    const snapshot: DeclaredSnapshot = {
      kind: 'declared',
      id,
      did: null,
      sourceUrl,
      title,
      links,
      importedAt: new Date().toISOString(),
    };
    const next = new Map(get().snapshots);
    next.set(id, snapshot);
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

/** Verified-only lookup by did — used by the scan-result sheet (dup check)
 * and `/people/profile/[did]`. A declared entry is never returned here
 * even in the practically-impossible case its hash id collided with a did
 * string, since `kind` is checked explicitly. */
export function getProfileSnapshot(did: string): VerifiedSnapshot | undefined {
  const found = useProfileSnapshotStore.getState().snapshots.get(did);
  return found?.kind === 'verified' ? found : undefined;
}

export const useProfileSnapshot = (did: string | undefined): VerifiedSnapshot | undefined =>
  useProfileSnapshotStore((s) => {
    if (!did) return undefined;
    const found = s.snapshots.get(did);
    return found?.kind === 'verified' ? found : undefined;
  });

/** Declared-only lookup by `stableDeclaredId(sourceUrl)` — used by
 * `/people/declared/[id]`. */
export function getDeclaredSnapshot(id: string): DeclaredSnapshot | undefined {
  const found = useProfileSnapshotStore.getState().snapshots.get(id);
  return found?.kind === 'declared' ? found : undefined;
}

export const useDeclaredSnapshot = (id: string | undefined): DeclaredSnapshot | undefined =>
  useProfileSnapshotStore((s) => {
    if (!id) return undefined;
    const found = s.snapshots.get(id);
    return found?.kind === 'declared' ? found : undefined;
  });

/** Verified entries first (newest `verifiedAt` first, unchanged from A2.3),
 * then declared entries (newest `importedAt` first) — the order the People
 * tab's saved-pages section renders in. A cryptographically-verified page
 * always outranks an unverified claim, regardless of recency. Exported
 * standalone (not just the hook below) so the ordering is unit-testable
 * without mounting React. */
export function sortedProfileSnapshots(
  snapshots: ReadonlyMap<string, ProfileSnapshot>,
): readonly ProfileSnapshot[] {
  const verified: VerifiedSnapshot[] = [];
  const declared: DeclaredSnapshot[] = [];
  for (const snapshot of snapshots.values()) {
    if (snapshot.kind === 'verified') verified.push(snapshot);
    else declared.push(snapshot);
  }
  verified.sort((a, b) => (a.verifiedAt < b.verifiedAt ? 1 : a.verifiedAt > b.verifiedAt ? -1 : 0));
  declared.sort((a, b) => (a.importedAt < b.importedAt ? 1 : a.importedAt > b.importedAt ? -1 : 0));
  return [...verified, ...declared];
}

/** `useShallow` is required: this selector derives a fresh array every
 * call, and Zustand v5's `useSyncExternalStore` snapshot caching would
 * otherwise treat that new reference as a state change on every render —
 * see the equivalent note on `useContactListDetail` in
 * `contacts/repository.ts`. */
export const useSortedProfileSnapshots = (): readonly ProfileSnapshot[] =>
  useProfileSnapshotStore(useShallow((s) => sortedProfileSnapshots(s.snapshots)));
