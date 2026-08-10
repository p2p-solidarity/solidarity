import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';

let openCount = 0;
let deletedDatabaseCount = 0;
let deleteDatabaseFails = false;
const deletedFiles: string[] = [];

import type { CacheDatabaseWipeDependencies } from '../../src/storage/cache';

// Keep the source module importable in Bun. The deletion behaviour itself is
// injected below so this mock cannot leak native-module state into the test.
await mock.module('expo-file-system/legacy', () => ({}));
await mock.module('expo-sqlite', () => ({}));
await mock.module('../../src/storage/mmkv', () => ({
  getMmkv: () => ({
    getString: () => undefined,
    set: () => undefined,
    remove: () => undefined,
  }),
}));

const { CacheService, deleteCacheDatabaseForLocalWipe } = await import('../../src/storage/cache');

function wipeDependencies(): CacheDatabaseWipeDependencies {
  return {
    createDatabase: async () => {
      openCount += 1;
      return { close: async () => undefined };
    },
    deleteDatabase: async () => {
      deletedDatabaseCount += 1;
      if (deleteDatabaseFails) throw new Error('private sqlite failure');
    },
    databaseDirectory: '/sqlite',
    deleteSidecar: async (path) => {
      deletedFiles.push(path);
    },
  };
}

beforeEach(() => {
  openCount = 0;
  deletedDatabaseCount = 0;
  deleteDatabaseFails = false;
  deletedFiles.length = 0;
  __resetLocalDataWipeBarrierForTesting();
});

afterEach(() => {
  __resetLocalDataWipeBarrierForTesting();
});

describe('CacheService local-data wipe barrier', () => {
  it('does not expose hot data or lazily recreate SQLite while a wipe is active', async () => {
    beginLocalDataWipe();

    expect(CacheService.getSync<{ private: boolean }>('profile')).toBeNull();
    expect(await CacheService.get<{ private: boolean }>('profile')).toBeNull();
    expect(openCount).toBe(0);
  });

  it('strictly deletes the database and its SQLite sidecars, idempotently', async () => {
    beginLocalDataWipe();

    expect(await deleteCacheDatabaseForLocalWipe(wipeDependencies())).toEqual({ ok: true, value: undefined });
    expect(await deleteCacheDatabaseForLocalWipe(wipeDependencies())).toEqual({ ok: true, value: undefined });
    expect(deletedDatabaseCount).toBe(2);
    expect(deletedFiles).toEqual([
      'file:///sqlite/solidarity-cache.db-wal',
      'file:///sqlite/solidarity-cache.db-shm',
      'file:///sqlite/solidarity-cache.db-journal',
      'file:///sqlite/solidarity-cache.db-wal',
      'file:///sqlite/solidarity-cache.db-shm',
      'file:///sqlite/solidarity-cache.db-journal',
    ]);
  });

  it('fails closed when deletion cannot remove the SQLite database', async () => {
    beginLocalDataWipe();
    deleteDatabaseFails = true;

    const result = await deleteCacheDatabaseForLocalWipe(wipeDependencies());

    expect(result).toEqual({ ok: false, error: { kind: 'storageFailed' } });
    expect(JSON.stringify(result)).not.toContain('private sqlite failure');
  });

  it('refuses a direct cache delete outside an active local-data wipe', async () => {
    const result = await deleteCacheDatabaseForLocalWipe(wipeDependencies());

    expect(result).toEqual({ ok: false, error: { kind: 'storageFailed' } });
    expect(openCount).toBe(0);
  });
});
