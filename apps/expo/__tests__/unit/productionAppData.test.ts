import { describe, expect, it } from 'bun:test';

import {
  clearProductionAppData,
  type ProductionAppDataDependencies,
} from '../../src/settings/productionAppData';

function dependencies(
  calls: string[],
  failingTarget?: 'productionFiles' | 'persistentData' | 'memoryCaches',
): ProductionAppDataDependencies {
  return {
    deleteFiles: async () => {
      calls.push('productionFiles');
      return failingTarget === 'productionFiles'
        ? { ok: false, error: { kind: 'storageFailed' } }
        : { ok: true, value: undefined };
    },
    clearPersistentData: () => {
      calls.push('persistentData');
      if (failingTarget === 'persistentData') {
        throw new Error('private persistence detail');
      }
    },
    clearMemoryCaches: () => {
      calls.push('memoryCaches');
      if (failingTarget === 'memoryCaches') {
        throw new Error('private cache detail');
      }
    },
  };
}

describe('clearProductionAppData', () => {
  it('deletes vault files before MMKV and clears memory caches last', async () => {
    const calls: string[] = [];

    const result = await clearProductionAppData(dependencies(calls));

    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual(['productionFiles', 'persistentData', 'memoryCaches']);
  });

  it('keeps MMKV and caches intact when vault directory deletion fails', async () => {
    const calls: string[] = [];

    const result = await clearProductionAppData(
      dependencies(calls, 'productionFiles'),
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(calls).toEqual(['productionFiles']);
  });

  it('does not clear caches when persistent deletion fails', async () => {
    const calls: string[] = [];

    const result = await clearProductionAppData(
      dependencies(calls, 'persistentData'),
    );

    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(calls).toEqual(['productionFiles', 'persistentData']);
    expect(JSON.stringify(result)).not.toContain('private persistence detail');
  });
});
