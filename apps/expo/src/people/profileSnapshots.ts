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
  stableJSON,
  type ProfileLink,
  type ProfileRecord,
  type ProfileScope,
} from '@solidarity/shared';

const KEY = 'profileSnapshots:v1';

/**
 * The projection scope a signed record represents (T7). An absent `record.
 * scope` means `full` — every pre-T7 record and every Pear/full card omits it.
 * Verified snapshots are keyed by `(did, scope)` so a `public` projection
 * (fetched from Nostr) and a `full` card (Pear-exchanged) for the SAME did
 * COEXIST instead of being flagged a `conflict`; the equal-`updatedAt`-
 * different-content conflict rule only ever fires WITHIN one scope.
 */
export function scopeOf(record: ProfileRecord): ProfileScope {
  return record.scope ?? 'full';
}

/** Richness order for choosing which scope to SURFACE when a did has more than
 *  one stored projection: full (all links) > shared (public+link-only) >
 *  public (public only). Higher = shown/preferred. */
const SCOPE_RANK: Record<ProfileScope, number> = { full: 3, shared: 2, public: 1 };
const SCOPE_BY_RANK: readonly ProfileScope[] = ['full', 'shared', 'public'];

/**
 * Composite Map key for a verified snapshot (T7): `<scope>:<did>`. Scope-
 * prefixed so per-scope projections of one did land in distinct slots and
 * coexist. A declared entry keeps its 24-hex `stableDeclaredId` key, which can
 * never collide with a `<scope>:<did>` string. Legacy pre-T7 entries persisted
 * under a bare `did` are re-keyed to `full:<did>` on hydrate (their record has
 * no `scope` → `full`).
 */
export function verifiedKey(did: string, scope: ProfileScope): string {
  return `${scope}:${did}`;
}

/**
 * A signed version of a peer's page seen at the SAME `record.updatedAt` as
 * the stored primary but with DIFFERENT signed content (T5 freshness/conflict
 * policy). Kept ALONGSIDE the primary — never silently overwriting it — so a
 * genuine fork ("two devices both signed an edit at the same second") is
 * surfaced, not lost. Empty in the overwhelmingly common case.
 */
export interface VerifiedConflict {
  readonly record: ProfileRecord;
  readonly jws: string;
  /** ISO timestamp of when THIS DEVICE verified this conflicting version. */
  readonly verifiedAt: string;
}

export interface VerifiedSnapshot {
  readonly kind: 'verified';
  readonly did: string;
  /** Which projection scope this snapshot holds (T7). Derived from the signed
   *  `record.scope` (absent = 'full'); part of the `(did, scope)` store key so
   *  a public projection and a full card for one did coexist. */
  readonly scope: ProfileScope;
  readonly record: ProfileRecord;
  readonly jws: string;
  /** ISO timestamp of when THIS DEVICE last locally verified the page. */
  readonly verifiedAt: string;
  /**
   * Device-owned free-text annotation. Lives OUTSIDE the signed `record` on
   * purpose (T5): an incoming/refreshed signed record neither carries nor
   * clears it, so a note the user wrote survives every freshness merge. Null
   * when unset — never fabricated.
   */
  readonly note: string | null;
  /** Same-timestamp, different-content forks kept as conflict markers. */
  readonly conflicts: readonly VerifiedConflict[];
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

/**
 * Result of merging a freshly-verified signed page into the store, keyed by
 * its root DID (T5 — replaces the old unconditional overwrite). One tagged
 * union, four outcomes, each carrying the resulting stored primary snapshot:
 *
 *   - `saved`          — brand-new DID, or the incoming record's signed
 *     `updatedAt` is strictly newer than the stored one → the record + jws
 *     were replaced and `verifiedAt` refreshed (device note preserved).
 *   - `alreadyCurrent` — byte-identical signed content → only the local
 *     `verifiedAt` was refreshed (we re-verified the exact same page).
 *   - `keptNewer`      — the incoming record is OLDER than the stored one →
 *     the local copy is kept UNCHANGED (its `verifiedAt` is NOT refreshed:
 *     we did not re-verify the stored newer content, only an older claim).
 *   - `conflict`       — same `updatedAt`, DIFFERENT signed content → the
 *     stored primary is kept and the incoming version is recorded as a
 *     `VerifiedConflict` marker; NEVER a silent overwrite.
 *
 * Used by BOTH the Verify-tab revisit-revalidate path and the T5 Pear mutual
 * card import, so the exact same freshness/conflict semantics apply however a
 * signed page arrives.
 */
export type SnapshotMergeOutcome =
  | { readonly kind: 'saved'; readonly snapshot: VerifiedSnapshot }
  | { readonly kind: 'alreadyCurrent'; readonly snapshot: VerifiedSnapshot }
  | { readonly kind: 'keptNewer'; readonly snapshot: VerifiedSnapshot }
  | { readonly kind: 'conflict'; readonly snapshot: VerifiedSnapshot };

/** −1 / 0 / +1 comparing two ISO-8601 `updatedAt` strings by their parsed
 *  instant. Falls back to a stable string compare only if either string is
 *  unparseable (the schema guarantees valid ISO for stored records, so this
 *  is defence-in-depth) — an equal/ambiguous result routes to the
 *  fail-closed `conflict` branch rather than to a silent overwrite. */
function compareUpdatedAt(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a < b ? -1 : a > b ? 1 : 0;
  return ta < tb ? -1 : ta > tb ? 1 : 0;
}

/**
 * Pure freshness/conflict merge — no store, no I/O, no clock (the caller
 * passes `nowIso`), so every branch is unit-testable in isolation. Given the
 * currently-stored verified snapshot for a DID (or `undefined` if none), plus
 * a freshly-verified `record`/`jws`, returns the outcome AND the snapshot to
 * persist. The caller is responsible for actually writing `outcome.snapshot`.
 */
export function mergeVerifiedSnapshot(
  existing: VerifiedSnapshot | undefined,
  record: ProfileRecord,
  jws: string,
  nowIso: string
): SnapshotMergeOutcome {
  // T7: the merge is per-scope. The caller looks `existing` up by
  // `(did, scope)`, so a public projection never lands here as the `existing`
  // for a full card — they occupy different store slots. Every produced
  // snapshot stamps the incoming record's scope.
  const scope = scopeOf(record);
  if (!existing) {
    return {
      kind: 'saved',
      snapshot: { kind: 'verified', did: record.did, scope, record, jws, verifiedAt: nowIso, note: null, conflicts: [] },
    };
  }

  const incomingContent = stableJSON(record);
  if (incomingContent === stableJSON(existing.record)) {
    // Same signed content — we just re-verified the exact page. Refresh
    // `verifiedAt` and adopt the fresh `jws` (ECDSA re-signs to a different
    // signature over identical bytes), but keep the device note + conflicts.
    return { kind: 'alreadyCurrent', snapshot: { ...existing, jws, verifiedAt: nowIso } };
  }

  const cmp = compareUpdatedAt(record.updatedAt, existing.record.updatedAt);
  if (cmp > 0) {
    // Strictly newer — replace record + jws, refresh verifiedAt, PRESERVE the
    // device note, and drop the old conflicts (they were forks of the now
    // superseded older `updatedAt`).
    return {
      kind: 'saved',
      snapshot: {
        kind: 'verified',
        did: existing.did,
        scope,
        record,
        jws,
        verifiedAt: nowIso,
        note: existing.note,
        conflicts: [],
      },
    };
  }
  if (cmp < 0) {
    // Older than what we hold — keep the local copy exactly as-is.
    return { kind: 'keptNewer', snapshot: existing };
  }

  // Equal `updatedAt`, different content — a genuine fork. Keep the primary,
  // record the incoming as a conflict marker (deduped by content so an
  // idempotent retry doesn't append duplicates), and NEVER overwrite.
  const alreadyRecorded = existing.conflicts.some((c) => stableJSON(c.record) === incomingContent);
  const conflicts = alreadyRecorded
    ? existing.conflicts
    : [...existing.conflicts, { record, jws, verifiedAt: nowIso }];
  return { kind: 'conflict', snapshot: { ...existing, conflicts } };
}

const declaredLinksSchema = z.array(profileLinkSchema);

interface PersistedVerifiedEntry {
  readonly kind?: 'verified'; // absent on entries persisted before this task — back-compat
  readonly record: unknown;
  readonly jws: unknown;
  readonly verifiedAt: unknown;
  readonly note?: unknown; // absent on pre-T5 entries — back-compat
  readonly conflicts?: unknown; // absent on pre-T5 entries — back-compat
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

/** Re-validate a persisted `conflicts` array (T5) per-entry: each conflict's
 *  `record` must still `parseProfile`, `jws`/`verifiedAt` must be non-empty
 *  strings. Anything malformed is dropped, matching the whole-store
 *  fail-closed-per-entry policy — a corrupt conflict never nukes its primary.
 *  A pre-T5 entry has no `conflicts` field at all → an empty list. */
function readPersistedConflicts(raw: unknown): readonly VerifiedConflict[] {
  if (!Array.isArray(raw)) return [];
  const out: VerifiedConflict[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const c = item as { readonly record?: unknown; readonly jws?: unknown; readonly verifiedAt?: unknown };
    if (typeof c.jws !== 'string' || c.jws.length === 0) continue;
    if (typeof c.verifiedAt !== 'string' || c.verifiedAt.length === 0) continue;
    const parsed = parseProfile(c.record);
    if (!parsed.ok) continue;
    out.push({ record: parsed.value, jws: c.jws, verifiedAt: c.verifiedAt });
  }
  return out;
}

/** Hydrate one persisted DECLARED entry (or `null` if malformed). */
function readPersistedDeclared(key: string, entry: PersistedDeclaredEntry): DeclaredSnapshot | null {
  if (typeof entry.sourceUrl !== 'string' || entry.sourceUrl.length === 0) return null;
  if (typeof entry.importedAt !== 'string' || entry.importedAt.length === 0) return null;
  const linksResult = declaredLinksSchema.safeParse(entry.links);
  if (!linksResult.success) return null;
  return {
    kind: 'declared',
    id: key,
    did: null,
    sourceUrl: entry.sourceUrl,
    title: typeof entry.title === 'string' ? entry.title : null,
    links: linksResult.data,
    importedAt: entry.importedAt,
  };
}

/** Hydrate one persisted VERIFIED entry (or `null` if malformed). A pre-A2.4
 *  entry with no `kind` and a pre-T5 entry with no `note`/`conflicts` both
 *  flow through here unchanged (back-compat via optional fields). */
function readPersistedVerified(entry: PersistedVerifiedEntry): VerifiedSnapshot | null {
  if (typeof entry.jws !== 'string' || entry.jws.length === 0) return null;
  if (typeof entry.verifiedAt !== 'string' || entry.verifiedAt.length === 0) return null;
  const validated = parseProfile(entry.record);
  if (!validated.ok) return null;
  const note = typeof entry.note === 'string' && entry.note.trim().length > 0 ? entry.note : null;
  return {
    kind: 'verified',
    did: validated.value.did,
    // Derived from the signed record — never persisted separately, so a pre-T7
    // entry (no `record.scope`) hydrates as 'full' with no migration pass.
    scope: scopeOf(validated.value),
    record: validated.value,
    jws: entry.jws,
    verifiedAt: entry.verifiedAt,
    note,
    conflicts: readPersistedConflicts(entry.conflicts),
  };
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
        const declared = readPersistedDeclared(key, entry);
        if (declared) out.set(key, declared);
        continue;
      }
      // A verified entry is RE-KEYED to its `(did, scope)` composite key,
      // derived from the parsed record — this migrates legacy pre-T7 entries
      // (persisted under a bare `did`, scope absent → `full:<did>`) in place,
      // with no separate migration pass, and is idempotent for entries already
      // written under the composite key.
      const verified = readPersistedVerified(entry);
      if (verified) out.set(verifiedKey(verified.did, verified.scope), verified);
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
          ? {
              kind: 'verified',
              record: snapshot.record,
              jws: snapshot.jws,
              verifiedAt: snapshot.verifiedAt,
              note: snapshot.note,
              conflicts: snapshot.conflicts.map((c) => ({
                record: c.record,
                jws: c.jws,
                verifiedAt: c.verifiedAt,
              })),
            }
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
  /**
   * Merge a freshly-verified signed page into the store, keyed by
   * `record.did`, applying the T5 freshness/conflict policy
   * (`mergeVerifiedSnapshot`) instead of the old unconditional overwrite.
   * Returns the tagged `SnapshotMergeOutcome` so a caller can HONESTLY report
   * what happened (saved / already current / kept newer / conflict) — the
   * distinction the Pear mutual-import receipt and the scan-result toast both
   * depend on. Preserves any device note across updates.
   */
  readonly mergeVerified: (record: ProfileRecord, jws: string) => SnapshotMergeOutcome;
  /** Set (or clear, with `null`/blank) the device-owned note for a saved
   *  verified snapshot. No-op if the DID isn't a saved verified page. */
  readonly setNote: (did: string, note: string | null) => void;
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

  mergeVerified: (record, jws) => {
    // T7: key by `(did, scope)` so a public projection and a full card for the
    // same did land in distinct slots and coexist — the conflict rule only
    // fires within one scope.
    const key = verifiedKey(record.did, scopeOf(record));
    const current = get().snapshots.get(key);
    const existing = current?.kind === 'verified' ? current : undefined;
    const outcome = mergeVerifiedSnapshot(existing, record, jws, new Date().toISOString());
    // `keptNewer` returns the existing snapshot reference unchanged, so this
    // set is a harmless no-op there; every other outcome carries the mutated
    // primary to persist.
    const next = new Map(get().snapshots);
    next.set(key, outcome.snapshot);
    writePersisted(next);
    set({ snapshots: next });
    return outcome;
  },

  setNote: (did, note) => {
    // The note is a per-person annotation; attach it to the richest projection
    // we hold for this did (the one `getProfileSnapshot` surfaces).
    const key = bestVerifiedKeyForDid(get().snapshots, did);
    if (!key) return;
    const current = get().snapshots.get(key);
    if (current?.kind !== 'verified') return;
    const trimmed = note?.trim() ?? '';
    const next = new Map(get().snapshots);
    next.set(key, { ...current, note: trimmed.length > 0 ? trimmed : null });
    writePersisted(next);
    set({ snapshots: next });
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

/** The richest-scope verified snapshot stored for a did (full > shared >
 *  public), or undefined if none. Probes the `(did, scope)` composite keys in
 *  rank order and returns the first hit — a stable stored reference (never a
 *  fresh object), so it's safe as a Zustand selector result. */
function bestVerifiedForDid(
  snapshots: ReadonlyMap<string, ProfileSnapshot>,
  did: string
): VerifiedSnapshot | undefined {
  for (const scope of SCOPE_BY_RANK) {
    const found = snapshots.get(verifiedKey(did, scope));
    if (found?.kind === 'verified') return found;
  }
  return undefined;
}

/** The composite key of the richest-scope verified snapshot for a did. */
function bestVerifiedKeyForDid(
  snapshots: ReadonlyMap<string, ProfileSnapshot>,
  did: string
): string | undefined {
  for (const scope of SCOPE_BY_RANK) {
    const key = verifiedKey(did, scope);
    if (snapshots.get(key)?.kind === 'verified') return key;
  }
  return undefined;
}

/** Verified-only lookup by did — used by the scan-result sheet (dup check)
 * and `/people/profile/[did]`. Returns the richest-scope projection stored for
 * the did (T7: full > shared > public). A declared entry is never returned
 * here since `kind` is checked explicitly. */
export function getProfileSnapshot(did: string): VerifiedSnapshot | undefined {
  return bestVerifiedForDid(useProfileSnapshotStore.getState().snapshots, did);
}

export const useProfileSnapshot = (did: string | undefined): VerifiedSnapshot | undefined =>
  useProfileSnapshotStore((s) => (did ? bestVerifiedForDid(s.snapshots, did) : undefined));

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
  // T7: a did can now hold multiple projections (public/shared/full). The
  // People list shows ONE row per person — the richest scope we hold — so
  // per-scope projections never surface as duplicate rows.
  const bestByDid = new Map<string, VerifiedSnapshot>();
  const declared: DeclaredSnapshot[] = [];
  for (const snapshot of snapshots.values()) {
    if (snapshot.kind === 'verified') {
      const prev = bestByDid.get(snapshot.did);
      if (!prev || SCOPE_RANK[snapshot.scope] > SCOPE_RANK[prev.scope]) {
        bestByDid.set(snapshot.did, snapshot);
      }
    } else {
      declared.push(snapshot);
    }
  }
  const verified = [...bestByDid.values()];
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
