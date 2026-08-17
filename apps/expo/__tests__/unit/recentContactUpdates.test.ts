import { beforeEach, describe, expect, it } from 'bun:test';

import {
  RECENT_UPDATES_STORAGE_KEY,
  __setRecentUpdatesStorageForTesting,
  createRecentProfileUpdate,
  hydrateRecentUpdates,
  resetRecentUpdatesStoreForTesting,
  useRecentUpdatesStore,
  type RecentUpdatesStorage,
} from '../../src/contacts/recentUpdates';
import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';
import type { ProfileRecord } from '@solidarity/shared';

const BASE: ProfileRecord = {
  v: 1,
  did: 'did:key:z6MkiTBz1ymY3uB6vQmSWMB7vQ9K4tE5pGvYo6WDZKpX8qHk',
  displayName: 'April Lee',
  bio: 'Designer',
  avatar: null,
  links: [{ label: 'Site', url: 'https://april.example' }],
  badges: [],
  alsoKnownAs: [],
  supersededBy: null,
  updatedAt: '2026-08-09T00:00:00.000Z',
};

function memoryStorage(seed: string | null = null): {
  readonly storage: RecentUpdatesStorage;
  readonly values: Map<string, string>;
} {
  const values = new Map<string, string>();
  if (seed !== null) values.set(RECENT_UPDATES_STORAGE_KEY, seed);
  return {
    values,
    storage: {
      getString: (key) => values.get(key) ?? null,
      setString: (key, value) => { values.set(key, value); },
    },
  };
}

describe('Recent Updates from real profile merges', () => {
  beforeEach(() => {
    resetRecentUpdatesStoreForTesting();
    __setRecentUpdatesStorageForTesting(null);
    __resetLocalDataWipeBarrierForTesting();
  });

  it('creates an event only from changed fields on an existing newer profile', () => {
    const incoming: ProfileRecord = {
      ...BASE,
      displayName: 'April C. Lee',
      links: [...BASE.links, { label: 'Work', url: 'https://work.example' }],
      updatedAt: '2026-08-10T00:00:00.000Z',
    };

    expect(createRecentProfileUpdate(BASE, incoming, 'event-1', '2026-08-10T01:00:00.000Z'))
      .toMatchObject({ id: 'event-1', name: 'April C. Lee', changes: ['name', 'links'] });
    expect(createRecentProfileUpdate(BASE, BASE, 'event-2', '2026-08-10T01:00:00.000Z'))
      .toBeNull();
    expect(createRecentProfileUpdate(undefined, incoming, 'event-3', '2026-08-10T01:00:00.000Z'))
      .toBeNull();
  });

  it('persists events, collapse state, and the separate global enable switch without seed data', () => {
    const memory = memoryStorage();
    __setRecentUpdatesStorageForTesting(memory.storage);
    hydrateRecentUpdates();
    expect(useRecentUpdatesStore.getState()).toMatchObject({ events: [], expanded: true, enabled: true });

    const incoming = { ...BASE, bio: 'Product designer', updatedAt: '2026-08-10T00:00:00.000Z' };
    useRecentUpdatesStore.getState().recordMerge(BASE, incoming, 'event-1', '2026-08-10T01:00:00.000Z');
    useRecentUpdatesStore.getState().setExpanded(false);
    useRecentUpdatesStore.getState().setEnabled(false);

    resetRecentUpdatesStoreForTesting();
    hydrateRecentUpdates();
    expect(useRecentUpdatesStore.getState()).toMatchObject({
      expanded: false,
      enabled: false,
      events: [{ id: 'event-1', changes: ['bio'] }],
    });
  });

  it('fails closed on an incompatible persisted feed and resets its live state after a local wipe', () => {
    const memory = memoryStorage(JSON.stringify({
      version: 2,
      enabled: true,
      expanded: true,
      events: [],
    }));
    __setRecentUpdatesStorageForTesting(memory.storage);
    hydrateRecentUpdates();
    expect(useRecentUpdatesStore.getState().status).toBe('error');

    const reset = Reflect.get(useRecentUpdatesStore.getState(), 'resetForLocalWipe');
    expect(reset).toBeTypeOf('function');
    if (typeof reset !== 'function') return;
    reset();
    expect(useRecentUpdatesStore.getState()).toMatchObject({
      status: 'loading',
      enabled: true,
      expanded: true,
      events: [],
    });
  });

  it('does not persist a merged profile change while a local-data wipe owns storage', () => {
    const memory = memoryStorage();
    __setRecentUpdatesStorageForTesting(memory.storage);
    hydrateRecentUpdates();
    beginLocalDataWipe();

    useRecentUpdatesStore.getState().recordMerge(
      BASE,
      { ...BASE, bio: 'Would be stale', updatedAt: '2026-08-10T00:00:00.000Z' },
      'event-wipe',
      '2026-08-10T01:00:00.000Z',
    );
    expect(useRecentUpdatesStore.getState().events).toEqual([]);

    completeLocalDataWipe();
  });
});
