import { beforeEach, describe, expect, it } from 'bun:test';

import { PRO_OFFLINE_GRACE_MS, type ProEntitlementRecord } from '../../src/pro/entitlement';
import {
  PRO_ENTITLEMENT_STORAGE_KEY,
  __resetProEntitlementStoreForTesting,
  __setProEntitlementStorageForTesting,
  hydrateProEntitlement,
  useProEntitlementStore,
  type ProEntitlementStorage,
} from '../../src/pro/entitlementStore';

function memoryStorage(seed: Record<string, string> = {}): {
  readonly map: Map<string, string>;
  readonly storage: ProEntitlementStorage;
} {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    storage: {
      getString: (key) => map.get(key) ?? null,
      setString: (key, value) => {
        map.set(key, value);
      },
      remove: (key) => {
        map.delete(key);
      },
    },
  };
}

function throwingStorage(): ProEntitlementStorage {
  return {
    getString: () => {
      throw new Error('storage unavailable');
    },
    setString: () => {
      throw new Error('storage unavailable');
    },
    remove: () => {
      throw new Error('storage unavailable');
    },
  };
}

const RECORD: ProEntitlementRecord = {
  productId: 'gg.solidarity.pro.yearly',
  source: 'appStore',
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  verifiedAt: Date.now(),
};

beforeEach(() => {
  __resetProEntitlementStoreForTesting();
  __setProEntitlementStorageForTesting(memoryStorage().storage);
});

describe('hydrateProEntitlement', () => {
  it('settles to free when nothing is stored', () => {
    hydrateProEntitlement();
    const state = useProEntitlementStore.getState();
    expect(state.status).toBe('ready');
    expect(state.record).toBeNull();
  });

  it('restores a persisted record', () => {
    const { storage } = memoryStorage({
      [PRO_ENTITLEMENT_STORAGE_KEY]: JSON.stringify(RECORD),
    });
    __setProEntitlementStorageForTesting(storage);
    hydrateProEntitlement();
    expect(useProEntitlementStore.getState().record).toEqual(RECORD);
  });

  it('treats an unreadable blob as free rather than erroring the store', () => {
    const { storage } = memoryStorage({ [PRO_ENTITLEMENT_STORAGE_KEY]: '{not json' });
    __setProEntitlementStorageForTesting(storage);
    hydrateProEntitlement();
    const state = useProEntitlementStore.getState();
    expect(state.status).toBe('ready');
    expect(state.record).toBeNull();
  });

  it('reports error when storage itself is unavailable', () => {
    __setProEntitlementStorageForTesting(throwingStorage());
    hydrateProEntitlement();
    expect(useProEntitlementStore.getState().status).toBe('error');
  });
});

describe('entitlement mutations', () => {
  it('persists a verified entitlement', () => {
    const { map, storage } = memoryStorage();
    __setProEntitlementStorageForTesting(storage);
    useProEntitlementStore.getState().applyEntitlement(RECORD);

    expect(useProEntitlementStore.getState().record).toEqual(RECORD);
    expect(JSON.parse(map.get(PRO_ENTITLEMENT_STORAGE_KEY) ?? 'null')).toEqual(RECORD);
  });

  it('still grants access for the session when persistence fails', () => {
    // A paying user must never be denied what they bought because MMKV is
    // wedged; the record is re-verified on next launch anyway.
    __setProEntitlementStorageForTesting(throwingStorage());
    useProEntitlementStore.getState().applyEntitlement(RECORD);
    expect(useProEntitlementStore.getState().record).toEqual(RECORD);
  });

  it('clears entitlement when an authority revokes it', () => {
    const { map, storage } = memoryStorage();
    __setProEntitlementStorageForTesting(storage);
    useProEntitlementStore.getState().applyEntitlement(RECORD);
    useProEntitlementStore.getState().clearEntitlement();

    expect(useProEntitlementStore.getState().record).toBeNull();
    expect(map.has(PRO_ENTITLEMENT_STORAGE_KEY)).toBe(false);
  });

  it('keeps the cached record when a refresh merely fails', () => {
    // The north-star rule: our outage extends, it never revokes.
    useProEntitlementStore.getState().applyEntitlement(RECORD);
    useProEntitlementStore.getState().markCheckFailed(Date.now());

    const state = useProEntitlementStore.getState();
    expect(state.record).toEqual(RECORD);
    expect(state.lastCheckedAt).not.toBeNull();
  });

  it('keeps a just-expired subscription alive through an offline stretch', () => {
    const lapsed: ProEntitlementRecord = {
      ...RECORD,
      expiresAt: Date.now() - PRO_OFFLINE_GRACE_MS / 2,
    };
    useProEntitlementStore.getState().applyEntitlement(lapsed);
    useProEntitlementStore.getState().markCheckFailed(Date.now());
    expect(useProEntitlementStore.getState().record).toEqual(lapsed);
  });

  it('drops entitlement on local wipe', () => {
    const { map, storage } = memoryStorage();
    __setProEntitlementStorageForTesting(storage);
    useProEntitlementStore.getState().applyEntitlement(RECORD);
    useProEntitlementStore.getState().resetForLocalWipe();

    expect(useProEntitlementStore.getState().record).toBeNull();
    expect(map.has(PRO_ENTITLEMENT_STORAGE_KEY)).toBe(false);
  });
});
