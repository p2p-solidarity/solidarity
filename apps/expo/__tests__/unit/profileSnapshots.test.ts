/**
 * Profile snapshots — People-side persistence for a scanned/verified
 * Verified Page AND a declared (unverified) link-page import (1.3.3 Tasks
 * A2.3 + A2.4, apps/expo/src/people/profileSnapshots.ts).
 *
 * What this suite pins:
 *   1. `upsert` persists to MMKV and is readable back through `hydrate`
 *      after an in-memory reset (simulated app restart).
 *   2. Re-scanning the SAME did overwrites in place (one entry, not two)
 *      and refreshes `verifiedAt`.
 *   3. A corrupt/schema-invalid persisted entry is dropped, not surfaced —
 *      fails closed per-entry rather than nuking the whole store.
 *   4. (A2.4) A legacy persisted entry with NO `kind` field (written before
 *      A2.4 shipped) hydrates as `kind: 'verified'` — the back-compat
 *      migration path.
 *   5. (A2.4) `upsertDeclared` round-trips the same way `upsert` does,
 *      dedupes by `stableDeclaredId(sourceUrl)`, and a schema-invalid
 *      declared entry is dropped the same way a bad verified one is.
 *   6. (A2.4) `sortedProfileSnapshots` with mixed kinds: every verified
 *      entry sorts before every declared entry, regardless of timestamps.
 *
 * Isolation: mocks only `@/storage/mmkv`, same pattern as profileStore.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ProfileRecord } from '@solidarity/shared';

interface DeclaredLink {
  readonly label: string;
  readonly url: string;
}

interface VerifiedConflictShape {
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly verifiedAt: string;
}

interface VerifiedSnapshotShape {
  readonly kind: 'verified';
  readonly did: string;
  readonly record: ProfileRecord;
  readonly jws: string;
  readonly verifiedAt: string;
  readonly note: string | null;
  readonly conflicts: readonly VerifiedConflictShape[];
}

type MergeOutcomeShape =
  | { readonly kind: 'saved'; readonly snapshot: VerifiedSnapshotShape }
  | { readonly kind: 'alreadyCurrent'; readonly snapshot: VerifiedSnapshotShape }
  | { readonly kind: 'keptNewer'; readonly snapshot: VerifiedSnapshotShape }
  | { readonly kind: 'conflict'; readonly snapshot: VerifiedSnapshotShape };

interface DeclaredSnapshotShape {
  readonly kind: 'declared';
  readonly id: string;
  readonly did: null;
  readonly sourceUrl: string;
  readonly title: string | null;
  readonly links: readonly DeclaredLink[];
  readonly importedAt: string;
}

type SnapshotShape = VerifiedSnapshotShape | DeclaredSnapshotShape;

interface ProfileSnapshotModuleSurface {
  readonly useProfileSnapshotStore: {
    getState: () => {
      readonly snapshots: ReadonlyMap<string, SnapshotShape>;
      readonly mergeVerified: (record: ProfileRecord, jws: string) => MergeOutcomeShape;
      readonly setNote: (did: string, note: string | null) => void;
      readonly upsertDeclared: (
        sourceUrl: string,
        title: string | null,
        links: readonly DeclaredLink[]
      ) => DeclaredSnapshotShape;
    };
    setState: (s: { snapshots: ReadonlyMap<string, unknown> }) => void;
  };
  readonly hydrateProfileSnapshots: () => void;
  readonly getProfileSnapshot: (did: string) => VerifiedSnapshotShape | undefined;
  readonly getDeclaredSnapshot: (id: string) => DeclaredSnapshotShape | undefined;
  readonly stableDeclaredId: (sourceUrl: string) => string;
  readonly mergeVerifiedSnapshot: (
    existing: VerifiedSnapshotShape | undefined,
    record: ProfileRecord,
    jws: string,
    nowIso: string
  ) => MergeOutcomeShape;
  readonly sortedProfileSnapshots: (snapshots: ReadonlyMap<string, SnapshotShape>) => readonly SnapshotShape[];
}

const kv = new Map<string, string>();
let mod: ProfileSnapshotModuleSurface;

function record(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    v: 1,
    did: 'did:key:zAlice',
    displayName: 'Alice',
    avatar: null,
    bio: '',
    links: [],
    alsoKnownAs: [],
    badges: [],
    supersededBy: null,
    updatedAt: '2026-07-03T00:00:00Z',
    ...overrides,
  };
}

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (k: string): string | undefined => kv.get(k),
      set: (k: string, v: string): void => {
        kv.set(k, v);
      },
      remove: (k: string): void => {
        kv.delete(k);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
    }),
  }));
  mod = (await import('../../src/people/profileSnapshots')) as unknown as ProfileSnapshotModuleSurface;
});

beforeEach(() => {
  kv.clear();
  mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
});

describe('upsert — persists and round-trips through MMKV', () => {
  it('persists a snapshot readable back after hydrate (simulated app restart)', () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ displayName: 'Alice' }), 'a.b.c');
    expect(mod.getProfileSnapshot('did:key:zAlice')).toBeDefined();

    mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
    expect(mod.getProfileSnapshot('did:key:zAlice')).toBeUndefined();

    mod.hydrateProfileSnapshots();
    const restored = mod.getProfileSnapshot('did:key:zAlice');
    expect(restored).toBeDefined();
    expect(restored?.did).toBe('did:key:zAlice');
  });

  it('re-scanning the same did with a NEWER record overwrites in place, not a second entry', () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ displayName: 'Alice' }), 'a.b.c');
    const outcome = mod.useProfileSnapshotStore
      .getState()
      .mergeVerified(record({ displayName: 'Alice V2', updatedAt: '2026-07-04T00:00:00Z' }), 'x.y.z');

    expect(outcome.kind).toBe('saved');
    expect(mod.useProfileSnapshotStore.getState().snapshots.size).toBe(1);
    expect(mod.getProfileSnapshot('did:key:zAlice')?.record.displayName).toBe('Alice V2');
  });

  it('refreshes verifiedAt on a re-scan of identical content (alreadyCurrent)', async () => {
    const first = mod.useProfileSnapshotStore.getState().mergeVerified(record(), 'a.b.c');
    expect(first.kind).toBe('saved');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = mod.useProfileSnapshotStore.getState().mergeVerified(record(), 'a.b.c');
    expect(second.kind).toBe('alreadyCurrent');
    expect(Date.parse(second.snapshot.verifiedAt)).toBeGreaterThanOrEqual(Date.parse(first.snapshot.verifiedAt));
  });
});

describe('hydrateProfileSnapshots — fails closed per-entry on corrupt data', () => {
  it('leaves the store empty when nothing has ever been saved', () => {
    mod.hydrateProfileSnapshots();
    expect(mod.useProfileSnapshotStore.getState().snapshots.size).toBe(0);
  });

  it('drops a schema-invalid entry without throwing or corrupting the rest', () => {
    kv.set(
      'profileSnapshots:v1',
      JSON.stringify({
        'did:key:zGood': {
          record: record({ did: 'did:key:zGood' }),
          jws: 'a.b.c',
          verifiedAt: '2026-07-03T00:00:00Z',
        },
        'did:key:zBad': {
          record: { v: 1, did: 'did:key:zBad' }, // missing required fields
          jws: 'x.y.z',
          verifiedAt: '2026-07-03T00:00:00Z',
        },
      })
    );
    expect(() => { mod.hydrateProfileSnapshots(); }).not.toThrow();
    expect(mod.getProfileSnapshot('did:key:zGood')).toBeDefined();
    expect(mod.getProfileSnapshot('did:key:zBad')).toBeUndefined();
  });

  it('fails closed to an empty store on a corrupt JSON blob', () => {
    kv.set('profileSnapshots:v1', '{not json');
    expect(() => { mod.hydrateProfileSnapshots(); }).not.toThrow();
    expect(mod.useProfileSnapshotStore.getState().snapshots.size).toBe(0);
  });
});

describe('sortedProfileSnapshots — newest verifiedAt first (People tab section order)', () => {
  it('returns an empty array for an empty store', () => {
    expect(mod.sortedProfileSnapshots(new Map())).toEqual([]);
  });

  it('orders multiple snapshots by verifiedAt descending, independent of insertion order', async () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zA', displayName: 'A' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zB', displayName: 'B' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zC', displayName: 'C' }), 'a.b.c');

    const sorted = mod.sortedProfileSnapshots(mod.useProfileSnapshotStore.getState().snapshots);
    expect(sorted.map((s) => s.did)).toEqual(['did:key:zC', 'did:key:zB', 'did:key:zA']);
  });

  it('re-scanning (upsert on an existing did) moves it back to the front', async () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zA', displayName: 'A' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zB', displayName: 'B' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    // Re-scan A — its verifiedAt refreshes even though the did already exists.
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zA', displayName: 'A' }), 'x.y.z');

    const sorted = mod.sortedProfileSnapshots(mod.useProfileSnapshotStore.getState().snapshots);
    expect(sorted.map((s) => s.did)).toEqual(['did:key:zA', 'did:key:zB']);
  });
});

describe('legacy shape back-compat — a pre-A2.4 persisted entry has no `kind` field', () => {
  it('hydrates a kind-less entry as kind: "verified"', () => {
    // Exact shape `writePersisted` produced before Task A2.4 added the
    // discriminated union: no `kind` key at all.
    kv.set(
      'profileSnapshots:v1',
      JSON.stringify({
        'did:key:zLegacy': {
          record: record({ did: 'did:key:zLegacy', displayName: 'Legacy' }),
          jws: 'a.b.c',
          verifiedAt: '2026-01-01T00:00:00Z',
        },
      })
    );
    mod.hydrateProfileSnapshots();
    const restored = mod.getProfileSnapshot('did:key:zLegacy');
    expect(restored).toBeDefined();
    expect(restored?.kind).toBe('verified');
    expect(restored?.record.displayName).toBe('Legacy');
  });
});

describe('upsertDeclared — persists and round-trips through MMKV, same shape as upsert', () => {
  const PORTFOLIO_LINK: DeclaredLink = { label: 'Portfolio', url: 'https://alice.example/portfolio' };
  const TWITTER_LINK: DeclaredLink = { label: 'Twitter', url: 'https://x.com/alice' };
  const LINKS: DeclaredLink[] = [PORTFOLIO_LINK, TWITTER_LINK];

  it('persists a declared snapshot readable back after hydrate (simulated app restart)', () => {
    const saved = mod.useProfileSnapshotStore.getState().upsertDeclared('https://linktr.ee/alice', 'Alice', LINKS);
    expect(saved.kind).toBe('declared');
    expect(saved.did).toBeNull();
    expect(mod.getDeclaredSnapshot(saved.id)).toBeDefined();

    mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
    expect(mod.getDeclaredSnapshot(saved.id)).toBeUndefined();

    mod.hydrateProfileSnapshots();
    const restored = mod.getDeclaredSnapshot(saved.id);
    expect(restored).toBeDefined();
    expect(restored?.sourceUrl).toBe('https://linktr.ee/alice');
    expect(restored?.title).toBe('Alice');
    expect(restored?.links).toEqual(LINKS);
  });

  it('re-pasting the same sourceUrl overwrites in place (same stableDeclaredId), not a second entry', () => {
    mod.useProfileSnapshotStore.getState().upsertDeclared('https://linktr.ee/alice', 'Alice', LINKS);
    mod.useProfileSnapshotStore.getState().upsertDeclared('https://linktr.ee/alice', 'Alice V2', [PORTFOLIO_LINK]);

    expect(mod.useProfileSnapshotStore.getState().snapshots.size).toBe(1);
    const id = mod.stableDeclaredId('https://linktr.ee/alice');
    const restored = mod.getDeclaredSnapshot(id);
    expect(restored?.title).toBe('Alice V2');
    expect(restored?.links).toEqual([PORTFOLIO_LINK]);
  });

  it('stableDeclaredId is deterministic for the same URL (after trim) and differs across URLs', () => {
    expect(mod.stableDeclaredId('https://linktr.ee/alice')).toBe(mod.stableDeclaredId('  https://linktr.ee/alice  '));
    expect(mod.stableDeclaredId('https://linktr.ee/alice')).not.toBe(mod.stableDeclaredId('https://linktr.ee/bob'));
  });

  // Post-review fix (round 1): normalize scheme/host/path/fragment before
  // hashing so trivially-equivalent URLs collapse to one declared id, while
  // deliberately keeping the query string significant (see module doc's
  // `normalizeForHashing` comment for why).
  it('stableDeclaredId treats a trailing slash, a different scheme/host case, and a fragment as the SAME page', () => {
    const base = mod.stableDeclaredId('https://linktr.ee/alice');
    expect(mod.stableDeclaredId('https://linktr.ee/alice/')).toBe(base);
    expect(mod.stableDeclaredId('HTTPS://LinkTr.EE/alice')).toBe(base);
    expect(mod.stableDeclaredId('https://linktr.ee/alice#section')).toBe(base);
    // All three combined at once.
    expect(mod.stableDeclaredId('HTTPS://LinkTr.EE/alice/#top')).toBe(base);
  });

  it('stableDeclaredId treats a different query string as a DIFFERENT page', () => {
    const base = mod.stableDeclaredId('https://linktr.ee/alice');
    const tagged = mod.stableDeclaredId('https://linktr.ee/alice?tab=2');
    expect(tagged).not.toBe(base);
    // Same query string still collapses with the other normalizations.
    expect(mod.stableDeclaredId('https://linktr.ee/alice/?tab=2#x')).toBe(tagged);
  });

  it('stableDeclaredId falls back to the trimmed raw string (never throws) for a URL the URL parser rejects', () => {
    expect(() => mod.stableDeclaredId('not a url at all')).not.toThrow();
    expect(mod.stableDeclaredId('not a url at all')).toBe(mod.stableDeclaredId('  not a url at all  '));
  });

  it('a null title persists and restores as null, never fabricated', () => {
    const saved = mod.useProfileSnapshotStore.getState().upsertDeclared('https://bare.example/', null, LINKS);
    mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
    mod.hydrateProfileSnapshots();
    expect(mod.getDeclaredSnapshot(saved.id)?.title).toBeNull();
  });

  it('a declared entry with schema-invalid links is dropped on hydrate without corrupting the rest', () => {
    kv.set(
      'profileSnapshots:v1',
      JSON.stringify({
        goodDeclared: {
          kind: 'declared',
          sourceUrl: 'https://good.example/',
          title: 'Good',
          links: [{ label: 'Site', url: 'https://good.example/site' }],
          importedAt: '2026-01-01T00:00:00Z',
        },
        badDeclared: {
          kind: 'declared',
          sourceUrl: 'https://bad.example/',
          title: 'Bad',
          links: [{ label: 'Evil', url: 'javascript:alert(1)' }], // fails profileLinkSchema
          importedAt: '2026-01-01T00:00:00Z',
        },
      })
    );
    expect(() => { mod.hydrateProfileSnapshots(); }).not.toThrow();
    expect(mod.getDeclaredSnapshot('goodDeclared')).toBeDefined();
    expect(mod.getDeclaredSnapshot('badDeclared')).toBeUndefined();
  });
});

describe('sortedProfileSnapshots — mixed kinds: verified first, then declared by importedAt', () => {
  it('every verified entry sorts before every declared entry, regardless of timestamps', async () => {
    // Declared entry is imported FIRST (older importedAt)...
    mod.useProfileSnapshotStore.getState().upsertDeclared('https://old-declared.example/', 'Old Declared', []);
    await new Promise((resolve) => setTimeout(resolve, 5));
    // ...then a verified entry is scanned LATER (newer verifiedAt). A naive
    // single-timestamp sort would still put verified first here, so this
    // alone doesn't prove the "kind" precedence — the next assertion does.
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zNewVerified', displayName: 'New Verified' }), 'a.b.c');

    const sorted = mod.sortedProfileSnapshots(mod.useProfileSnapshotStore.getState().snapshots);
    expect(sorted.map((s) => s.kind)).toEqual(['verified', 'declared']);
  });

  it('an OLDER verified entry still sorts before a NEWER declared entry (kind beats recency)', async () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zOldVerified', displayName: 'Old Verified' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().upsertDeclared('https://new-declared.example/', 'New Declared', []);

    const sorted = mod.sortedProfileSnapshots(mod.useProfileSnapshotStore.getState().snapshots);
    expect(sorted.map((s) => s.kind)).toEqual(['verified', 'declared']);
  });

  it('within each kind, newest timestamp sorts first', async () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zV1', displayName: 'V1' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ did: 'did:key:zV2', displayName: 'V2' }), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().upsertDeclared('https://d1.example/', 'D1', []);
    await new Promise((resolve) => setTimeout(resolve, 5));
    mod.useProfileSnapshotStore.getState().upsertDeclared('https://d2.example/', 'D2', []);

    const sorted = mod.sortedProfileSnapshots(mod.useProfileSnapshotStore.getState().snapshots);
    const verifiedDids = sorted.filter((s) => s.kind === 'verified').map((s) => s.did);
    const declaredIds = sorted.filter((s) => s.kind === 'declared').map((s) => s.sourceUrl);
    expect(verifiedDids).toEqual(['did:key:zV2', 'did:key:zV1']);
    expect(declaredIds).toEqual(['https://d2.example/', 'https://d1.example/']);
  });
});

// ── T5 freshness/conflict merge policy ─────────────────────────────────────

function verified(overrides: Partial<VerifiedSnapshotShape> = {}): VerifiedSnapshotShape {
  return {
    kind: 'verified',
    did: 'did:key:zAlice',
    record: record(),
    jws: 'a.b.c',
    verifiedAt: '2026-07-03T00:00:00Z',
    note: null,
    conflicts: [],
    ...overrides,
  };
}

const NOW = '2026-07-10T12:00:00Z';

describe('mergeVerifiedSnapshot — pure freshness/conflict branches', () => {
  it('no existing entry → saved, fresh verifiedAt, empty note/conflicts', () => {
    const out = mod.mergeVerifiedSnapshot(undefined, record(), 'a.b.c', NOW);
    expect(out.kind).toBe('saved');
    expect(out.snapshot.verifiedAt).toBe(NOW);
    expect(out.snapshot.note).toBeNull();
    expect(out.snapshot.conflicts).toEqual([]);
  });

  it('byte-identical signed content → alreadyCurrent, only verifiedAt refreshed', () => {
    const existing = verified({ verifiedAt: '2026-07-01T00:00:00Z' });
    const out = mod.mergeVerifiedSnapshot(existing, record(), 'newsig.b.c', NOW);
    expect(out.kind).toBe('alreadyCurrent');
    expect(out.snapshot.verifiedAt).toBe(NOW);
    // Same content → the record is unchanged; the fresh signature is adopted.
    expect(out.snapshot.record.displayName).toBe('Alice');
    expect(out.snapshot.jws).toBe('newsig.b.c');
  });

  it('strictly newer updatedAt → saved (replaces record + jws), verifiedAt refreshed', () => {
    const existing = verified();
    const newer = record({ displayName: 'Alice V2', updatedAt: '2026-07-05T00:00:00Z' });
    const out = mod.mergeVerifiedSnapshot(existing, newer, 'x.y.z', NOW);
    expect(out.kind).toBe('saved');
    expect(out.snapshot.record.displayName).toBe('Alice V2');
    expect(out.snapshot.jws).toBe('x.y.z');
    expect(out.snapshot.verifiedAt).toBe(NOW);
  });

  it('older updatedAt → keptNewer, local copy UNCHANGED (verifiedAt not refreshed)', () => {
    const existing = verified({
      record: record({ displayName: 'Alice Current', updatedAt: '2026-07-05T00:00:00Z' }),
      verifiedAt: '2026-07-05T09:00:00Z',
    });
    const older = record({ displayName: 'Alice Stale', updatedAt: '2026-07-01T00:00:00Z' });
    const out = mod.mergeVerifiedSnapshot(existing, older, 'stale.jws.here', NOW);
    expect(out.kind).toBe('keptNewer');
    expect(out.snapshot.record.displayName).toBe('Alice Current');
    expect(out.snapshot.verifiedAt).toBe('2026-07-05T09:00:00Z'); // NOT refreshed
    expect(out.snapshot.jws).not.toBe('stale.jws.here');
  });

  it('equal updatedAt, different content → conflict; primary kept, incoming recorded, NO overwrite', () => {
    const existing = verified({ record: record({ displayName: 'Alice A' }) });
    const forked = record({ displayName: 'Alice B' }); // same default updatedAt, different name
    const out = mod.mergeVerifiedSnapshot(existing, forked, 'fork.jws.here', NOW);
    expect(out.kind).toBe('conflict');
    // Primary is untouched...
    expect(out.snapshot.record.displayName).toBe('Alice A');
    // ...and the fork is preserved as a conflict marker, never silently lost.
    expect(out.snapshot.conflicts).toHaveLength(1);
    expect(out.snapshot.conflicts[0]?.record.displayName).toBe('Alice B');
    expect(out.snapshot.conflicts[0]?.jws).toBe('fork.jws.here');
  });

  it('conflict is idempotent — recording the SAME fork twice does not duplicate it', () => {
    const existing = verified({ record: record({ displayName: 'Alice A' }) });
    const forked = record({ displayName: 'Alice B' });
    const first = mod.mergeVerifiedSnapshot(existing, forked, 'fork.jws.here', NOW);
    expect(first.kind).toBe('conflict');
    const second = mod.mergeVerifiedSnapshot(first.snapshot, forked, 'fork.jws.here', NOW);
    expect(second.kind).toBe('conflict');
    expect(second.snapshot.conflicts).toHaveLength(1);
  });

  it('device note survives a newer save, an alreadyCurrent refresh, and a conflict', () => {
    const noted = verified({ note: 'met at ETHGlobal' });
    const saved = mod.mergeVerifiedSnapshot(
      noted,
      record({ displayName: 'Alice V2', updatedAt: '2026-07-05T00:00:00Z' }),
      'x.y.z',
      NOW
    );
    expect(saved.kind).toBe('saved');
    expect(saved.snapshot.note).toBe('met at ETHGlobal');

    const current = mod.mergeVerifiedSnapshot(noted, record(), 'a.b.c', NOW);
    expect(current.snapshot.note).toBe('met at ETHGlobal');

    const conflicted = mod.mergeVerifiedSnapshot(noted, record({ bio: 'forked bio' }), 'f.j.k', NOW);
    expect(conflicted.kind).toBe('conflict');
    expect(conflicted.snapshot.note).toBe('met at ETHGlobal');
  });
});

describe('store.mergeVerified + setNote — persistence of conflicts and notes', () => {
  it('a conflict persists both the primary and the fork across a hydrate', () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record({ displayName: 'Primary' }), 'p.j.k');
    const outcome = mod.useProfileSnapshotStore
      .getState()
      .mergeVerified(record({ displayName: 'Fork' }), 'f.j.k'); // same default updatedAt
    expect(outcome.kind).toBe('conflict');

    mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
    mod.hydrateProfileSnapshots();

    const restored = mod.getProfileSnapshot('did:key:zAlice');
    expect(restored?.record.displayName).toBe('Primary');
    expect(restored?.conflicts).toHaveLength(1);
    expect(restored?.conflicts[0]?.record.displayName).toBe('Fork');
  });

  it('setNote persists and survives a later merge; clearing sets it back to null', () => {
    mod.useProfileSnapshotStore.getState().mergeVerified(record(), 'a.b.c');
    mod.useProfileSnapshotStore.getState().setNote('did:key:zAlice', '  coffee soon  ');
    expect(mod.getProfileSnapshot('did:key:zAlice')?.note).toBe('coffee soon'); // trimmed

    // A newer signed record arrives — the note must NOT be clobbered.
    mod.useProfileSnapshotStore
      .getState()
      .mergeVerified(record({ displayName: 'Alice V2', updatedAt: '2026-07-05T00:00:00Z' }), 'x.y.z');
    expect(mod.getProfileSnapshot('did:key:zAlice')?.note).toBe('coffee soon');

    // Round-trips through MMKV.
    mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
    mod.hydrateProfileSnapshots();
    expect(mod.getProfileSnapshot('did:key:zAlice')?.note).toBe('coffee soon');

    // Clearing.
    mod.useProfileSnapshotStore.getState().setNote('did:key:zAlice', '   ');
    expect(mod.getProfileSnapshot('did:key:zAlice')?.note).toBeNull();
  });

  it('setNote is a no-op for a did that is not a saved verified page', () => {
    expect(() => {
      mod.useProfileSnapshotStore.getState().setNote('did:key:zNobody', 'ghost');
    }).not.toThrow();
    expect(mod.getProfileSnapshot('did:key:zNobody')).toBeUndefined();
  });
});
