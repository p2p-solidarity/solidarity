import { describe, expect, it } from 'bun:test';

import {
  ANDROID_REVALIDATE_MS,
  PRO_OFFLINE_GRACE_MS,
  entitlementFromPurchase,
  evaluateProStatus,
  isProActive,
  parseProEntitlement,
  type ProEntitlementRecord,
} from '../../src/pro/entitlement';

const NOW = Date.UTC(2026, 8, 16);

function record(patch: Partial<ProEntitlementRecord> = {}): ProEntitlementRecord {
  return {
    productId: 'gg.solidarity.pro.yearly',
    source: 'appStore',
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    verifiedAt: NOW,
    ...patch,
  };
}

describe('evaluateProStatus', () => {
  it('has no entitlement without a record', () => {
    expect(evaluateProStatus(null, NOW)).toBe('free');
  });

  it('is pro strictly before the stated expiry', () => {
    expect(evaluateProStatus(record({ expiresAt: NOW + 1 }), NOW)).toBe('pro');
  });

  it('enters grace at the exact moment of expiry, not free', () => {
    // The boundary matters: a renewal we have not heard about yet lands here,
    // and dropping the user to `free` on the tick would paywall a paying
    // customer mid-renewal.
    expect(evaluateProStatus(record({ expiresAt: NOW }), NOW)).toBe('grace');
  });

  it('stays entitled through the whole offline grace window', () => {
    const expired = record({ expiresAt: NOW - PRO_OFFLINE_GRACE_MS + 1 });
    expect(evaluateProStatus(expired, NOW)).toBe('grace');
    expect(isProActive(evaluateProStatus(expired, NOW))).toBe(true);
  });

  it('falls back to free once grace is exhausted', () => {
    const stale = record({ expiresAt: NOW - PRO_OFFLINE_GRACE_MS });
    expect(evaluateProStatus(stale, NOW)).toBe('free');
    expect(isProActive(evaluateProStatus(stale, NOW))).toBe(false);
  });

  it('treats grace as entitled and free as not', () => {
    expect(isProActive('pro')).toBe(true);
    expect(isProActive('grace')).toBe(true);
    expect(isProActive('free')).toBe(false);
  });
});

describe('parseProEntitlement', () => {
  it('round-trips a well-formed record through JSON', () => {
    const original = record();
    expect(parseProEntitlement(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it('accepts every declared source', () => {
    for (const source of ['appStore', 'playStore', 'license'] as const) {
      expect(parseProEntitlement(record({ source }))?.source).toBe(source);
    }
  });

  it('rejects malformed blobs instead of throwing', () => {
    const rejected: unknown[] = [
      null,
      undefined,
      'pro',
      42,
      [],
      {},
      { ...record(), productId: '' },
      { ...record(), source: 'stripe' },
      { ...record(), expiresAt: 'soon' },
      { ...record(), expiresAt: Number.NaN },
      { ...record(), verifiedAt: Number.POSITIVE_INFINITY },
    ];
    for (const value of rejected) {
      expect(parseProEntitlement(value)).toBeNull();
    }
  });

  it('drops unknown fields rather than carrying them into state', () => {
    const parsed = parseProEntitlement({ ...record(), isPro: true, tier: 'enterprise' });
    expect(parsed).toEqual(record());
  });
});

describe('entitlementFromPurchase', () => {
  const SKU = 'gg.solidarity.pro.yearly';

  it('uses StoreKit 2\'s real expiry on iOS', () => {
    const expiry = NOW + 365 * 24 * 60 * 60 * 1000;
    expect(
      entitlementFromPurchase(
        { productId: SKU, expirationDateIOS: expiry },
        { productId: SKU, source: 'appStore', now: NOW }
      )
    ).toEqual({ productId: SKU, source: 'appStore', expiresAt: expiry, verifiedAt: NOW });
  });

  it('falls back to a short revalidation window when the store gives no expiry', () => {
    // Play Billing only says "active right now" — so we trust it for a day and
    // ask again, rather than inventing a year-long entitlement.
    const record = entitlementFromPurchase(
      { productId: SKU, purchaseState: 'purchased' },
      { productId: SKU, source: 'playStore', now: NOW }
    );
    expect(record?.expiresAt).toBe(NOW + ANDROID_REVALIDATE_MS);
    expect(record?.source).toBe('playStore');
  });

  it('ignores a purchase for a different product', () => {
    expect(
      entitlementFromPurchase(
        { productId: 'gg.solidarity.something.else', expirationDateIOS: NOW + 1000 },
        { productId: SKU, source: 'appStore', now: NOW }
      )
    ).toBeNull();
  });

  it('refuses an already-lapsed transaction rather than granting grace', () => {
    // Grace is for an authority we could not reach. One that answered and said
    // "this ended" must not be laundered into an entitlement.
    expect(
      entitlementFromPurchase(
        { productId: SKU, expirationDateIOS: NOW - 1 },
        { productId: SKU, source: 'appStore', now: NOW }
      )
    ).toBeNull();
    expect(
      entitlementFromPurchase(
        { productId: SKU, expirationDateIOS: NOW },
        { productId: SKU, source: 'appStore', now: NOW }
      )
    ).toBeNull();
  });

  it('never grants a purchase that is still pending payment', () => {
    // Play delivers cash / bank-transfer purchases as `pending` long before the
    // money clears. Granting on that would hand out Pro for nothing.
    for (const expirationDateIOS of [undefined, NOW + 1000]) {
      expect(
        entitlementFromPurchase(
          { productId: SKU, purchaseState: 'pending', expirationDateIOS },
          { productId: SKU, source: 'playStore', now: NOW }
        )
      ).toBeNull();
    }
  });

  it('grants an unknown-state purchase only when a real store expiry vouches for it', () => {
    // Android's UNSPECIFIED state must not be trusted, but a StoreKit 2
    // transaction with a real expiry is already authoritative.
    expect(
      entitlementFromPurchase(
        { productId: SKU, purchaseState: 'unknown' },
        { productId: SKU, source: 'playStore', now: NOW }
      )
    ).toBeNull();
    expect(
      entitlementFromPurchase(
        { productId: SKU, purchaseState: 'unknown', expirationDateIOS: NOW + 1000 },
        { productId: SKU, source: 'appStore', now: NOW }
      )?.expiresAt
    ).toBe(NOW + 1000);
    expect(
      entitlementFromPurchase(
        { productId: SKU, purchaseState: 'purchased' },
        { productId: SKU, source: 'playStore', now: NOW }
      )?.expiresAt
    ).toBe(NOW + ANDROID_REVALIDATE_MS);
  });

  it('treats a non-finite expiry as missing rather than trusting it', () => {
    for (const bogus of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
      const record = entitlementFromPurchase(
        { productId: SKU, purchaseState: 'purchased', expirationDateIOS: bogus as number | null | undefined },
        { productId: SKU, source: 'playStore', now: NOW }
      );
      expect(record?.expiresAt).toBe(NOW + ANDROID_REVALIDATE_MS);
    }
  });
});
