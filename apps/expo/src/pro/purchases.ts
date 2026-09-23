import { AppState, Platform } from 'react-native';
import type * as ExpoIap from 'expo-iap';
import type { ErrorCode, Purchase } from 'expo-iap';

import {
  entitlementFromPurchase as mapPurchase,
  type ProEntitlementRecord,
  type ProSource,
} from './entitlement';
import { useProEntitlementStore } from './entitlementStore';

/**
 * The single annual SKU. Must match the product identifier created in App Store
 * Connect and Play Console — see `docs/ref/09-plan-pro-entitlement.md` for the
 * store-configuration checklist.
 */
export const PRO_YEARLY_PRODUCT_ID = 'gg.solidarity.pro.yearly';

/**
 * Play Console base plan ID under that product. Play Billing requires an offer
 * token even for a plain base plan, so the purchase selects this plan's token
 * explicitly instead of trusting a native default.
 */
export const PRO_ANDROID_BASE_PLAN_ID = 'yearly';

/** The slice of expo-iap this module uses. Injectable so the money path is
 *  unit-tested without loading the native module (and without a process-global
 *  `mock.module`, which leaks across bun test files). */
export type ProStoreClient = Pick<
  typeof ExpoIap,
  | 'initConnection'
  | 'fetchProducts'
  | 'finishTransaction'
  | 'getAvailablePurchases'
  | 'purchaseErrorListener'
  | 'purchaseUpdatedListener'
  | 'requestPurchase'
  | 'restorePurchases'
>;

export type ProPurchaseOutcome =
  | { readonly kind: 'purchased' }
  | { readonly kind: 'cancelled' }
  /** Ask to Buy, bank approval, cash payment — the store delivers it later. */
  | { readonly kind: 'pending' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/** The store's own localized price string — never a hardcoded one. A Taiwan
 *  account is charged in NT$, and Apple requires the paywall to show the amount
 *  that will actually be billed. */
export type ProProductState =
  | {
      readonly kind: 'ready';
      readonly displayPrice: string;
      /** Play's offer token for the yearly base plan; `null` on iOS. */
      readonly androidOfferToken: string | null;
    }
  | { readonly kind: 'unavailable'; readonly reason: string };

/** What a refresh learned. Only `none` — the store answered, and our product
 *  is not there — ever clears an entitlement. */
export type ProRefreshResult = 'active' | 'none' | 'unreachable';

const USER_CANCELLED: `${ErrorCode}` = 'user-cancelled';
const DEFERRED_PAYMENT: `${ErrorCode}` = 'deferred-payment';

/** How long to wait for the purchase event after the store sheet closes before
 *  calling the purchase pending (Ask to Buy never emits a success event). */
const PURCHASE_EVENT_TIMEOUT_MS = 30_000;
/** Minimum spacing between foreground refreshes. */
const FOREGROUND_REFRESH_SPACING_MS = 60_000;

let injectedClient: ProStoreClient | null = null;
let connectionPromise: Promise<ProStoreClient | null> | null = null;
let listenersAttached = false;
let foregroundAttached = false;
let lastForegroundRefreshAt = 0;
let purchaseEventTimeoutMs = PURCHASE_EVENT_TIMEOUT_MS;

function storeSource(): ProSource {
  return Platform.OS === 'android' ? 'playStore' : 'appStore';
}

/** Map a store purchase onto our entitlement record for the annual SKU. */
export function entitlementFromPurchase(
  purchase: Purchase,
  now: number
): ProEntitlementRecord | null {
  return mapPurchase(purchase, {
    productId: PRO_YEARLY_PRODUCT_ID,
    source: storeSource(),
    now,
  });
}

async function ensureConnection(): Promise<ProStoreClient | null> {
  connectionPromise ??= (async () => {
    const store = injectedClient ?? (await import('expo-iap'));
    await store.initConnection();
    return store;
  })().catch(() => {
    // Let the next call retry rather than caching the failure forever.
    connectionPromise = null;
    return null;
  });
  return connectionPromise;
}

async function finishQuietly(store: ProStoreClient, purchase: Purchase): Promise<void> {
  try {
    // An unfinished subscription is re-delivered on every launch, and Play
    // auto-refunds one left unacknowledged for three days. Never consumable.
    await store.finishTransaction({ purchase, isConsumable: false });
  } catch {
    // Retried by the next refresh, which re-finishes whatever it finds.
  }
}

async function adoptPurchase(store: ProStoreClient, purchase: Purchase): Promise<void> {
  if (purchase.productId !== PRO_YEARLY_PRODUCT_ID) return;
  const record = entitlementFromPurchase(purchase, Date.now());
  // A pending purchase is neither granted nor acknowledged: acknowledging money
  // that has not cleared is exactly what the store's pending state forbids.
  if (!record && purchase.purchaseState === 'pending') return;
  if (record) useProEntitlementStore.getState().applyEntitlement(record);
  await finishQuietly(store, purchase);
}

function attachListeners(store: ProStoreClient): void {
  if (listenersAttached) return;
  listenersAttached = true;
  // Renewals, refunds, family sharing, and purchases made on another device all
  // arrive here rather than through the buy button.
  store.purchaseUpdatedListener((purchase) => {
    void adoptPurchase(store, purchase);
  });
  store.purchaseErrorListener(() => {
    // Purchase errors are reported by `purchaseProYearly`'s own result. A
    // background error must never revoke an entitlement we already hold.
    useProEntitlementStore.getState().markCheckFailed(Date.now());
  });
}

function attachForegroundRefresh(): void {
  if (foregroundAttached) return;
  foregroundAttached = true;
  AppState.addEventListener('change', (next) => {
    if (next !== 'active') return;
    const now = Date.now();
    if (now - lastForegroundRefreshAt < FOREGROUND_REFRESH_SPACING_MS) return;
    lastForegroundRefreshAt = now;
    void refreshProEntitlement();
  });
}

/** Connect, attach listeners, and pull current entitlement. Safe to repeat. */
export async function initProPurchases(): Promise<void> {
  const store = await ensureConnection();
  if (!store) {
    useProEntitlementStore.getState().markCheckFailed(Date.now());
    return;
  }
  attachListeners(store);
  attachForegroundRefresh();
  await refreshProEntitlement();
}

/**
 * Re-ask the store what this account currently owns.
 *
 * The only path that may CLEAR entitlement, and only when the store actually
 * answered. Failing to reach it records the attempt and changes nothing else.
 */
export async function refreshProEntitlement(): Promise<ProRefreshResult> {
  const entitlement = useProEntitlementStore.getState();
  const store = await ensureConnection();
  if (!store) {
    entitlement.markCheckFailed(Date.now());
    return 'unreachable';
  }

  let purchases: Purchase[];
  try {
    purchases = await store.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
  } catch {
    entitlement.markCheckFailed(Date.now());
    return 'unreachable';
  }

  const now = Date.now();
  let active: ProEntitlementRecord | null = null;
  for (const purchase of purchases) {
    if (purchase.productId !== PRO_YEARLY_PRODUCT_ID) continue;
    const record = entitlementFromPurchase(purchase, now);
    if (!record) continue;
    active ??= record;
    // Re-acknowledge anything a crash left unfinished.
    await finishQuietly(store, purchase);
  }

  if (active) {
    entitlement.applyEntitlement(active);
    return 'active';
  }
  entitlement.clearEntitlement();
  return 'none';
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return 'unknown';
}

interface AndroidOfferLike {
  readonly id?: string | null;
  readonly basePlanIdAndroid?: string | null;
  readonly offerTokenAndroid?: string | null;
}

/**
 * Pick the offer token for the yearly base plan. When a promotional offer is
 * listed alongside it, the plain base plan (whose id is the base plan id) wins,
 * so nobody is silently enrolled in an offer we did not mean to sell.
 */
function androidOfferToken(offers: readonly AndroidOfferLike[]): string | null {
  const inPlan = offers.filter(
    (offer) =>
      offer.basePlanIdAndroid === PRO_ANDROID_BASE_PLAN_ID &&
      typeof offer.offerTokenAndroid === 'string' &&
      offer.offerTokenAndroid.length > 0
  );
  const base = inPlan.find((offer) => offer.id === PRO_ANDROID_BASE_PLAN_ID) ?? inPlan[0];
  return base?.offerTokenAndroid ?? null;
}

function outcomeFromError(error: unknown): ProPurchaseOutcome {
  // Read as a plain string: errors arrive both as typed events and as raw
  // promise rejections, so the enum type is not guaranteed at runtime.
  const code: unknown = (error as { code?: unknown } | null)?.code;
  if (code === USER_CANCELLED) return { kind: 'cancelled' };
  if (code === DEFERRED_PAYMENT) return { kind: 'pending' };
  return { kind: 'failed', reason: describeError(error) };
}

/**
 * Fetch the annual SKU from the store. Also proves the product exists for this
 * build's bundle id / package name — a mismatch with App Store Connect or Play
 * Console surfaces here as `product-not-found`.
 */
export async function loadProYearlyProduct(): Promise<ProProductState> {
  const store = await ensureConnection();
  if (!store) return { kind: 'unavailable', reason: 'store-unreachable' };
  try {
    const products = await store.fetchProducts({
      skus: [PRO_YEARLY_PRODUCT_ID],
      type: 'subs',
    });
    const product = products?.find((candidate) => candidate.id === PRO_YEARLY_PRODUCT_ID);
    if (!product || product.displayPrice.length === 0) {
      return { kind: 'unavailable', reason: 'product-not-found' };
    }
    if (product.platform !== 'android') {
      return { kind: 'ready', displayPrice: product.displayPrice, androidOfferToken: null };
    }
    const offers = ('subscriptionOffers' in product ? product.subscriptionOffers : null) ?? [];
    const token = androidOfferToken(offers);
    // A product without the expected base plan cannot be bought correctly, so
    // say so before the sheet opens rather than failing inside Play.
    if (!token) return { kind: 'unavailable', reason: 'base-plan-not-found' };
    return { kind: 'ready', displayPrice: product.displayPrice, androidOfferToken: token };
  } catch (error) {
    return { kind: 'unavailable', reason: describeError(error) };
  }
}

/**
 * Start the annual subscription purchase.
 *
 * `requestPurchase` is event-based: its promise settling says the store sheet
 * closed, NOT that anything was bought. The outcome is read from the purchase
 * events, and this function never clears entitlement — a store list that lags
 * the purchase by a moment must not lock out the person who just paid.
 */
export async function purchaseProYearly(): Promise<ProPurchaseOutcome> {
  // Products must be fetched before StoreKit / Play Billing will sell them.
  const product = await loadProYearlyProduct();
  if (product.kind === 'unavailable') return product;
  const store = await ensureConnection();
  if (!store) return { kind: 'unavailable', reason: 'store-unreachable' };
  // The adopt path (grant + acknowledge) must be live before the sheet opens.
  attachListeners(store);

  return new Promise<ProPurchaseOutcome>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const updates = store.purchaseUpdatedListener((purchase) => {
      if (purchase.productId !== PRO_YEARLY_PRODUCT_ID) return;
      settle(entitlementFromPurchase(purchase, Date.now()) ? { kind: 'purchased' } : { kind: 'pending' });
    });
    const errors = store.purchaseErrorListener((error) => {
      settle(outcomeFromError(error));
    });

    function settle(outcome: ProPurchaseOutcome): void {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      updates.remove();
      errors.remove();
      resolve(outcome);
    }

    store
      .requestPurchase({
        request: {
          // Keys are SDK-level (apple / google), not OS-level.
          apple: { sku: PRO_YEARLY_PRODUCT_ID },
          google: {
            skus: [PRO_YEARLY_PRODUCT_ID],
            subscriptionOffers: product.androidOfferToken
              ? [{ sku: PRO_YEARLY_PRODUCT_ID, offerToken: product.androidOfferToken }]
              : null,
          },
        },
        type: 'subs',
      })
      .then(
        () => {
          if (settled) return;
          // Sheet closed with no event yet: the purchase is waiting on
          // something outside the app. The listener grants it when it clears.
          timer = setTimeout(() => {
            settle({ kind: 'pending' });
          }, purchaseEventTimeoutMs);
        },
        (error: unknown) => {
          settle(outcomeFromError(error));
        }
      );
  });
}

/**
 * The restore path Apple requires for any auto-renewable subscription. Reports
 * what the store actually said — an unreachable store is never "restored".
 */
export async function restoreProPurchases(): Promise<ProPurchaseOutcome> {
  const store = await ensureConnection();
  if (!store) return { kind: 'unavailable', reason: 'store-unreachable' };
  try {
    // iOS: AppStore.sync(). Its failure (e.g. a dismissed sign-in) still leaves
    // the locally known transactions worth reading below.
    await store.restorePurchases();
  } catch {
    // Fall through to the refresh.
  }
  switch (await refreshProEntitlement()) {
    case 'active':
      return { kind: 'purchased' };
    case 'none':
      return { kind: 'unavailable', reason: 'nothing-to-restore' };
    case 'unreachable':
      return { kind: 'unavailable', reason: 'store-unreachable' };
  }
}

export function __setProStoreClientForTesting(client: ProStoreClient | null): void {
  injectedClient = client;
  connectionPromise = null;
  listenersAttached = false;
  foregroundAttached = false;
  lastForegroundRefreshAt = 0;
}

export function __setPurchaseEventTimeoutForTesting(ms: number | null): void {
  purchaseEventTimeoutMs = ms ?? PURCHASE_EVENT_TIMEOUT_MS;
}
