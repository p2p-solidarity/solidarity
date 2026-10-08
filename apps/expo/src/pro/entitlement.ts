/**
 * Pro entitlement — the pure model. No storage, no network, no React.
 *
 * Three rules are encoded here rather than left to call sites, because every
 * one of them is a decision that is easy to quietly regress later:
 *
 * 1. **A lapse gates the editor, never the published page.** Nothing in this
 *    module ever deletes a block or rewrites a design. A subscriber who added
 *    a `shop` block and then lapsed keeps that block, keeps it published, and
 *    keeps it in their signed record — the editor just stops letting them
 *    change it. Downgrade must never destroy user data.
 *
 * 2. **An unreachable authority extends, never revokes.** If the store or the
 *    license bridge cannot be reached, a previously verified entitlement stays
 *    live through `PRO_OFFLINE_GRACE_MS`. This is `docs/ref/06`'s
 *    company-dies-still-works north star applied to billing: our outage is
 *    never the user's problem. The grace is capped so it degrades eventually
 *    rather than becoming a permanent free tier.
 *
 * 3. **This is convenience, not DRM.** The published Page is a record the user
 *    signs with their own did:key, so a determined user can always hand-edit it.
 *    We deliberately do not fight that — no clock-tamper defence, no
 *    attestation. Gating exists so paying is worth it, not to make not-paying
 *    impossible. Enforcement that actually binds lives where we serve: the
 *    creds.id renderer.
 */

/** Which authority told us this entitlement is real. */
export type ProSource =
  /** StoreKit 2 `Transaction.currentEntitlements` — verified by the OS. */
  | 'appStore'
  /** Play Billing `queryPurchasesAsync`, re-verified by our license bridge. */
  | 'playStore'
  /** A did:key-bound license minted by creds.id from a verified purchase. */
  | 'license';

export interface ProEntitlementRecord {
  readonly productId: string;
  readonly source: ProSource;
  /** Authority-stated end of the paid period, ms since epoch. */
  readonly expiresAt: number;
  /** When we last heard this from the authority, ms since epoch. */
  readonly verifiedAt: number;
}

/**
 * `grace` is Pro — it is reported separately only so the UI can say "we
 * couldn't reach the store" instead of silently pretending everything is fine.
 */
export type ProStatus = 'pro' | 'grace' | 'free';

/**
 * How long a verified entitlement outlives its stated expiry when we cannot
 * reach the authority to renew it. 14 days covers a normal offline stretch and
 * matches the order of Apple's own billing-retry grace, so a card that fails
 * and recovers never strands a paying user behind a paywall.
 */
export const PRO_OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

export function evaluateProStatus(
  record: ProEntitlementRecord | null,
  now: number
): ProStatus {
  if (!record) return 'free';
  if (now < record.expiresAt) return 'pro';
  if (now < record.expiresAt + PRO_OFFLINE_GRACE_MS) return 'grace';
  return 'free';
}

/** The single predicate every feature gate should ask. */
export function isProActive(status: ProStatus): boolean {
  return status !== 'free';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

const PRO_SOURCES: readonly ProSource[] = ['appStore', 'playStore', 'license'];

/**
 * Parse a persisted record. Anything malformed resolves to `null` (= free)
 * rather than throwing: a corrupt entitlement blob must not be able to brick
 * app launch, and failing closed here is the honest direction — we only ever
 * grant Pro from a record we can actually read.
 */
export function parseProEntitlement(raw: unknown): ProEntitlementRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;

  const { productId, source, expiresAt, verifiedAt } = candidate;
  if (typeof productId !== 'string' || productId.length === 0) return null;
  if (typeof source !== 'string') return null;
  if (!PRO_SOURCES.includes(source as ProSource)) return null;
  if (!isFiniteNumber(expiresAt) || !isFiniteNumber(verifiedAt)) return null;

  return {
    productId,
    source: source as ProSource,
    expiresAt,
    verifiedAt,
  };
}

/**
 * Android's `queryPurchasesAsync` answers "is this active right now" and carries
 * NO expiry, unlike StoreKit 2's real `expirationDateIOS`. So a Play purchase is
 * trusted for one revalidation window and re-asked on the next launch. The
 * offline grace above still layers on top, so being merely offline never drops
 * a paying user.
 */
export const ANDROID_REVALIDATE_MS = 24 * 60 * 60 * 1000;

/** The part of a store purchase this model actually reads. */
export interface StorePurchaseLike {
  readonly productId: string;
  readonly purchaseState?: 'pending' | 'purchased' | 'unknown';
  readonly expirationDateIOS?: number | null;
}

/**
 * Map a store purchase onto an entitlement record, or `null` when it is not a
 * live entitlement for `productId`.
 */
export function entitlementFromPurchase(
  purchase: StorePurchaseLike,
  options: { readonly productId: string; readonly source: ProSource; readonly now: number }
): ProEntitlementRecord | null {
  if (purchase.productId !== options.productId) return null;
  // Money that has not cleared (Play cash / bank-transfer purchases) is not an
  // entitlement, however long it sits there.
  if (purchase.purchaseState === 'pending') return null;

  const iosExpiry = purchase.expirationDateIOS;
  const hasStoreExpiry = isFiniteNumber(iosExpiry);
  // Without a store-issued expiry, only an explicitly completed purchase is
  // trusted; Android's UNSPECIFIED state must never grant.
  if (!hasStoreExpiry && purchase.purchaseState !== 'purchased') return null;

  const expiresAt = hasStoreExpiry ? iosExpiry : options.now + ANDROID_REVALIDATE_MS;

  // An already-lapsed transaction is not an entitlement. Grace exists for an
  // authority we could not REACH, never for one that told us it is over.
  if (expiresAt <= options.now) return null;

  return {
    productId: purchase.productId,
    source: options.source,
    expiresAt,
    verifiedAt: options.now,
  };
}
