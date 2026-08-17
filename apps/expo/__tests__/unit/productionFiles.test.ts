import { describe, expect, it } from 'bun:test';

import {
  deleteProductionFiles,
  type ProductionFilesDependencies,
} from '../../src/settings/productionFiles';

function dependencies(
  calls: string[],
  failingPath?: string,
): ProductionFilesDependencies {
  return {
    documentDirectory: 'file:///documents/',
    cacheDirectory: 'file:///cache/',
    deletePath: async (path) => {
      calls.push(path);
      if (path === failingPath) throw new Error('private filesystem detail');
    },
    deleteVaultFiles: async () => {
      calls.push('vault');
      return failingPath === 'vault'
        ? { ok: false, error: { kind: 'storageFailed' } }
        : { ok: true, value: undefined };
    },
    deleteCacheDatabase: async () => {
      calls.push('sqlite');
      return failingPath === 'sqlite'
        ? { ok: false, error: { kind: 'storageFailed' } }
        : { ok: true, value: undefined };
    },
  };
}

describe('deleteProductionFiles', () => {
  it('deletes every app-owned document, export, wallet, vault, and SQLite artifact', async () => {
    const calls: string[] = [];

    const result = await deleteProductionFiles(dependencies(calls));

    expect(result).toEqual({ ok: true, value: undefined });
    expect(new Set(calls)).toEqual(new Set([
      'file:///documents/profile-avatar/',
      'file:///documents/images/',
      'file:///documents/wallet/',
      'file:///cache/wallet/',
      'file:///cache/solidarity_vcs.json',
      'file:///cache/solidarity-contacts.vcf',
      'file:///cache/solidarity-qr.png',
      'vault',
      'sqlite',
    ]));
  });

  it('attempts every independent deletion and reports one redacted typed failure', async () => {
    const calls: string[] = [];

    const result = await deleteProductionFiles(
      dependencies(calls, 'file:///documents/images/'),
    );

    expect(calls).toContain('vault');
    expect(calls).toContain('sqlite');
    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(JSON.stringify(result)).not.toContain('private filesystem detail');
  });

  it('fails closed when a native storage root is unavailable', async () => {
    const calls: string[] = [];
    const deps = dependencies(calls);

    const result = await deleteProductionFiles({
      ...deps,
      cacheDirectory: null,
    });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(calls).toEqual([]);
  });
});
