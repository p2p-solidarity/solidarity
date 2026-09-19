import { beforeEach, describe, expect, it } from 'bun:test';
import type { Purchase } from 'expo-iap';

import { __setProEntitlementStorageForTesting, __resetProEntitlementStoreForTesting, useProEntitlementStore } from '../../src/pro/entitlementStore';
import {
  PRO_ANDROID_BASE_PLAN_ID,
  PRO_YEARLY_PRODUCT_ID,
  __setProStoreClientForTesting,
  __setPurchaseEventTimeoutForTesting,
  loadProYearlyProduct,
  purchaseProYearly,
  refreshProEntitlement,
  restoreProPurchases,
  type ProStoreClient,
} from '../../src/pro/purchases';

const DAY = 24 * 60 * 60 * 1000;

interface FakeOptions {
  connectFails?: boolean;
  queryFails?: boolean;
  products?: Record<string, unknown>[];
  available?: Purchase[];
  onRequest?: (fake: FakeStore) => Promise<void>;
}

interface FakeStore {
  client: ProStoreClient;
  readonly finished: string[];
  readonly requests: unknown[];
  available: Purchase[];
  emitUpdate: (purchase: Purchase) => void;
  emitError: (error: { code: string; message: string }) => void;
  listenerCount: () => number;
}

function purchase(patch: Record<string, unknown> = {}): Purchase {
  return {
    id: 'txn-1',
    productId: PRO_YEARLY_PRODUCT_ID,
    purchaseState: 'purchased',
    expirationDateIOS: Date.now() + 365 * DAY,
    isAutoRenewing: true,
    quantity: 1,
    store: 'apple',
    transactionDate: Date.now(),
    platform: 'ios',
    ...patch,
  } as unknown as Purchase;
}

function fakeStore(options: FakeOptions = {}): FakeStore {
  const updates = new Set<(purchase: Purchase) => void>();
  const errors = new Set<(error: unknown) => void>();
  const fake: FakeStore = {
    finished: [],
    requests: [],
    available: options.available ?? [],
    emitUpdate: (next) => {
      for (const listener of [...updates]) listener(next);
    },
    emitError: (error) => {
      for (const listener of [...errors]) listener(error);
    },
    listenerCount: () => updates.size,
    client: undefined as unknown as ProStoreClient,
  };
  const client = {
    initConnection: () => (options.connectFails ? Promise.reject(new Error('no store')) : Promise.resolve(true)),
    fetchProducts: () =>
      Promise.resolve(options.products ?? [{ id: PRO_YEARLY_PRODUCT_ID, displayPrice: 'NT$1,190' }]),
    finishTransaction: ({ purchase: done }: { purchase: Purchase }) => {
      fake.finished.push(done.id);
      return Promise.resolve();
    },
    getAvailablePurchases: () =>
      options.queryFails ? Promise.reject(new Error('query failed')) : Promise.resolve(fake.available),
    purchaseUpdatedListener: (listener: (p: Purchase) => void) => {
      updates.add(listener);
      return { remove: () => { updates.delete(listener); } };
    },
    purchaseErrorListener: (listener: (e: unknown) => void) => {
      errors.add(listener);
      return { remove: () => { errors.delete(listener); } };
    },
    requestPurchase: async (args: unknown) => {
      fake.requests.push(args);
      await options.onRequest?.(fake);
      return null;
    },
    restorePurchases: () => Promise.resolve(),
  };
  fake.client = client as unknown as ProStoreClient;
  return fake;
}

function install(fake: FakeStore): FakeStore {
  __setProStoreClientForTesting(fake.client);
  return fake;
}

const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

function grantCached(): void {
  useProEntitlementStore.getState().applyEntitlement({
    productId: PRO_YEARLY_PRODUCT_ID,
    source: 'appStore',
    expiresAt: Date.now() + 30 * DAY,
    verifiedAt: Date.now(),
  });
}

beforeEach(() => {
  const map = new Map<string, string>();
  __setProEntitlementStorageForTesting({
    getString: (key) => map.get(key) ?? null,
    setString: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  });
  __resetProEntitlementStoreForTesting();
  __setPurchaseEventTimeoutForTesting(5);
});

describe('refreshProEntitlement', () => {
  it('grants and acknowledges an active subscription', async () => {
    const fake = install(fakeStore({ available: [purchase()] }));
    expect(await refreshProEntitlement()).toBe('active');
    expect(useProEntitlementStore.getState().record?.productId).toBe(PRO_YEARLY_PRODUCT_ID);
    expect(fake.finished).toEqual(['txn-1']);
  });

  it('clears entitlement only when the store answers without the product', async () => {
    install(fakeStore({ available: [] }));
    grantCached();
    expect(await refreshProEntitlement()).toBe('none');
    expect(useProEntitlementStore.getState().record).toBeNull();
  });

  it('keeps entitlement when the store query fails', async () => {
    install(fakeStore({ queryFails: true }));
    grantCached();
    expect(await refreshProEntitlement()).toBe('unreachable');
    expect(useProEntitlementStore.getState().record).not.toBeNull();
  });

  it('keeps entitlement when the store cannot be connected at all', async () => {
    install(fakeStore({ connectFails: true }));
    grantCached();
    expect(await refreshProEntitlement()).toBe('unreachable');
    expect(useProEntitlementStore.getState().record).not.toBeNull();
  });

  it('neither grants nor acknowledges a pending purchase', async () => {
    const fake = install(fakeStore({
      available: [purchase({ purchaseState: 'pending', expirationDateIOS: null })],
    }));
    expect(await refreshProEntitlement()).toBe('none');
    expect(useProEntitlementStore.getState().record).toBeNull();
    expect(fake.finished).toEqual([]);
  });
});

describe('loadProYearlyProduct', () => {
  it('returns the store-localized price', async () => {
    install(fakeStore());
    expect(await loadProYearlyProduct()).toEqual({
      kind: 'ready',
      displayPrice: 'NT$1,190',
      androidOfferToken: null,
    });
  });

  it('reports a SKU the store does not know', async () => {
    install(fakeStore({ products: [] }));
    expect(await loadProYearlyProduct()).toEqual({ kind: 'unavailable', reason: 'product-not-found' });
  });
});

describe('purchaseProYearly', () => {
  it('resolves purchased from the purchase event and grants via the listener', async () => {
    const fake = install(fakeStore({
      onRequest: (store) => {
        store.emitUpdate(purchase());
        return Promise.resolve();
      },
    }));
    expect(await purchaseProYearly()).toEqual({ kind: 'purchased' });
    await tick();
    expect(useProEntitlementStore.getState().record).not.toBeNull();
    expect(fake.finished).toEqual(['txn-1']);
    // The one-shot listeners are gone; only the long-lived adopt listener stays.
    expect(fake.listenerCount()).toBe(1);
  });

  it('does not clear an existing entitlement while waiting on a lagging store', async () => {
    // The bug this guards: the old flow re-queried and CLEARED right after the
    // sheet closed, locking out someone who had just paid.
    install(fakeStore({ available: [] }));
    grantCached();
    expect(await purchaseProYearly()).toEqual({ kind: 'pending' });
    expect(useProEntitlementStore.getState().record).not.toBeNull();
  });

  it('reports cancellation without touching entitlement', async () => {
    install(fakeStore({
      onRequest: () => Promise.reject({ code: 'user-cancelled', message: 'cancelled' }),
    }));
    expect(await purchaseProYearly()).toEqual({ kind: 'cancelled' });
    expect(useProEntitlementStore.getState().record).toBeNull();
  });

  it('reports Ask to Buy as pending', async () => {
    install(fakeStore({
      onRequest: (store) => {
        store.emitError({ code: 'deferred-payment', message: 'waiting for approval' });
        return Promise.resolve();
      },
    }));
    expect(await purchaseProYearly()).toEqual({ kind: 'pending' });
  });

  it('reports a pending Play purchase as pending, not purchased', async () => {
    install(fakeStore({
      onRequest: (store) => {
        store.emitUpdate(purchase({ purchaseState: 'pending', expirationDateIOS: null }));
        return Promise.resolve();
      },
    }));
    expect(await purchaseProYearly()).toEqual({ kind: 'pending' });
    await tick();
    expect(useProEntitlementStore.getState().record).toBeNull();
  });

  it('never opens the purchase sheet for a SKU the store does not have', async () => {
    const fake = install(fakeStore({ products: [] }));
    expect(await purchaseProYearly()).toEqual({ kind: 'unavailable', reason: 'product-not-found' });
    expect(fake.requests).toEqual([]);
  });
});

describe('Android base plan offer', () => {
  function androidProduct(offers: Record<string, unknown>[]): Record<string, unknown> {
    return {
      id: PRO_YEARLY_PRODUCT_ID,
      platform: 'android',
      type: 'subs',
      displayPrice: 'NT$1,190',
      subscriptionOffers: offers,
    };
  }

  it('passes the yearly base plan offer token to Play Billing', async () => {
    const fake = install(fakeStore({
      products: [
        androidProduct([
          { id: 'intro', basePlanIdAndroid: PRO_ANDROID_BASE_PLAN_ID, offerTokenAndroid: 'tok-intro' },
          { id: PRO_ANDROID_BASE_PLAN_ID, basePlanIdAndroid: PRO_ANDROID_BASE_PLAN_ID, offerTokenAndroid: 'tok-base' },
        ]),
      ],
      onRequest: (store) => {
        store.emitUpdate(purchase({ expirationDateIOS: null }));
        return Promise.resolve();
      },
    }));
    expect(await purchaseProYearly()).toEqual({ kind: 'purchased' });
    // The plain base plan, not a promotional offer that happens to be listed first.
    expect(fake.requests[0]).toMatchObject({
      request: {
        google: {
          skus: [PRO_YEARLY_PRODUCT_ID],
          subscriptionOffers: [{ sku: PRO_YEARLY_PRODUCT_ID, offerToken: 'tok-base' }],
        },
      },
    });
  });

  it('refuses to open the sheet when the configured base plan is missing', async () => {
    const fake = install(fakeStore({
      products: [
        androidProduct([
          { id: 'monthly', basePlanIdAndroid: 'monthly', offerTokenAndroid: 'tok-monthly' },
        ]),
      ],
    }));
    expect(await purchaseProYearly()).toEqual({ kind: 'unavailable', reason: 'base-plan-not-found' });
    expect(fake.requests).toEqual([]);
  });
});

describe('restoreProPurchases', () => {
  it('restores an active subscription', async () => {
    install(fakeStore({ available: [purchase()] }));
    expect(await restoreProPurchases()).toEqual({ kind: 'purchased' });
  });

  it('says so when there is nothing to restore', async () => {
    install(fakeStore({ available: [] }));
    expect(await restoreProPurchases()).toEqual({ kind: 'unavailable', reason: 'nothing-to-restore' });
  });

  it('never reports a cached entitlement as restored when the store is unreachable', async () => {
    install(fakeStore({ queryFails: true }));
    grantCached();
    expect(await restoreProPurchases()).toEqual({ kind: 'unavailable', reason: 'store-unreachable' });
  });
});
