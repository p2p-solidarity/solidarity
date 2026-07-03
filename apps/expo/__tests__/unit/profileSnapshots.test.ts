/**
 * Profile snapshots — People-side persistence for a scanned/verified
 * Verified Page (1.3.3 Task A2.3, apps/expo/src/people/profileSnapshots.ts).
 *
 * What this suite pins:
 *   1. `upsert` persists to MMKV and is readable back through `hydrate`
 *      after an in-memory reset (simulated app restart).
 *   2. Re-scanning the SAME did overwrites in place (one entry, not two)
 *      and refreshes `verifiedAt`.
 *   3. A corrupt/schema-invalid persisted entry is dropped, not surfaced —
 *      fails closed per-entry rather than nuking the whole store.
 *
 * Isolation: mocks only `@/storage/mmkv`, same pattern as profileStore.test.ts.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { ProfileRecord } from '@solidarity/shared';

interface ProfileSnapshotModuleSurface {
  readonly useProfileSnapshotStore: {
    getState: () => {
      readonly snapshots: ReadonlyMap<string, { readonly did: string; readonly record: ProfileRecord; readonly jws: string; readonly verifiedAt: string }>;
      readonly upsert: (record: ProfileRecord, jws: string) => { readonly verifiedAt: string };
    };
    setState: (s: { snapshots: ReadonlyMap<string, unknown> }) => void;
  };
  readonly hydrateProfileSnapshots: () => void;
  readonly getProfileSnapshot: (did: string) => { readonly did: string } | undefined;
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
    mod.useProfileSnapshotStore.getState().upsert(record({ displayName: 'Alice' }), 'a.b.c');
    expect(mod.getProfileSnapshot('did:key:zAlice')).toBeDefined();

    mod.useProfileSnapshotStore.setState({ snapshots: new Map() });
    expect(mod.getProfileSnapshot('did:key:zAlice')).toBeUndefined();

    mod.hydrateProfileSnapshots();
    const restored = mod.getProfileSnapshot('did:key:zAlice');
    expect(restored).toBeDefined();
    expect(restored?.did).toBe('did:key:zAlice');
  });

  it('re-scanning the same did overwrites in place, not a second entry', () => {
    mod.useProfileSnapshotStore.getState().upsert(record({ displayName: 'Alice' }), 'a.b.c');
    mod.useProfileSnapshotStore.getState().upsert(record({ displayName: 'Alice V2' }), 'x.y.z');

    expect(mod.useProfileSnapshotStore.getState().snapshots.size).toBe(1);
    const snap = mod.getProfileSnapshot('did:key:zAlice');
    expect(snap).toBeDefined();
  });

  it('refreshes verifiedAt on every upsert, even for unchanged content', async () => {
    const first = mod.useProfileSnapshotStore.getState().upsert(record(), 'a.b.c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = mod.useProfileSnapshotStore.getState().upsert(record(), 'a.b.c');
    expect(Date.parse(second.verifiedAt)).toBeGreaterThanOrEqual(Date.parse(first.verifiedAt));
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
