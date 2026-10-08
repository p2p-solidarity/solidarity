# 09 — Pro entitlement (creator tier, IAP)

Status 2026-09-16: **app side built** (entitlement model, store, gates, IAP purchase/restore, compliant paywall, copy).
**Not built:** the creds.id license bridge, renderer-side enforcement, custom domains. Store products are not
created yet — the code uses the placeholder SKU below until they are.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | One tier now: **Pro, one annual auto-renewable SKU** `gg.solidarity.pro.yearly`. Business/analytics tier is a later, separate SKU. | $36/yr is creator pricing; bundling a business dashboard into it would cap its price forever. |
| D2 | Pro v1 = **advanced sections** (shop / booking / leave-card), **custom fonts + background colour**, **brand-off + own footer**. Nothing else is advertised. | Apple rejects paywalls that sell absent features. Custom domain needs the bridge; Organization has no implementation. |
| D3 | **IAP on both iOS and Android** via `expo-iap` 5.6.2 (OpenIAP; StoreKit 2 + Play Billing 9.1). | Post-Epic link-out is US-storefront only; Taiwan/global still require IAP. Play Billing ≥8 mandatory since 2026-08-31. |
| D4 | Receipt verification + license minting go in **our own worker** (`airmeishi-backend`, `solidarity-id` on creds.id), not RevenueCat. | RevenueCat cannot bind a purchase to a did:key, so the bridge is needed either way; the worker already signs Apple ES256 JWTs (`apns.ts`), verifies did-signed JWS (`nip05/jws.ts`), and has D1. RevenueCat stays the fallback if Play verification turns out painful. |
| D5 | Price is **always the store's `displayPrice`** — never a hardcoded currency. | TW accounts are billed in NT$; a misstated price breaks Guideline 3.1.2. Pinned by `proSurface.test.ts`. |

## Entitlement rules (encoded in `apps/expo/src/pro/entitlement.ts`)

1. **A lapse gates the editor, never the published page.** No code path deletes a block or resets appearance on downgrade.
2. **An unreachable authority extends, never revokes.** Verified entitlement survives `PRO_OFFLINE_GRACE_MS` (14 d) past expiry while
   the store can't be reached. Only a *successful* store answer without our product clears it (`refreshProEntitlement`).
3. **Convenience, not DRM.** The Page is user-signed, so editor gates are bypassable by hand-editing the record. Binding enforcement
   belongs where we serve (creds.id renderer) — that is the bridge's job, not the app's.

Android caveat: Play's client API has no expiry, so a present purchase is trusted for `ANDROID_REVALIDATE_MS` (24 h) and re-queried each launch.
It is also only client-reported truth; the bridge's server-side Play Developer API check is what hardens it.

## Code map

| File | Role |
|---|---|
| `src/pro/entitlement.ts` | Pure model: status evaluation, grace, parsing, purchase → record mapping |
| `src/pro/entitlementStore.ts` | zustand + MMKV (`pro:entitlement:v1`), hydrated at boot before first paint, cleared on device wipe |
| `src/pro/purchases.ts` | expo-iap: connection, listeners, product load, purchase, restore, refresh |
| `src/pro/useProGate.ts` | The only gate predicate; used by `ProfileSectionsList` + `PageAppearanceSheet` |
| `app/settings/pro.tsx` | Paywall: localized price, subscribe, restore, auto-renew terms, in-app Terms/Privacy, manage subscription |

## Store configuration checklist

Identifiers: iOS bundle `kidneyweakx.airmeishi` · Android package `gg.solidarity.app` · SKU `gg.solidarity.pro.yearly`.
A product ID can never be reused once created — if you pick a different one, change `PRO_YEARLY_PRODUCT_ID` before building.

### App Store Connect

| # | Where | What |
|---|---|---|
| A1 | Business → Agreements, Tax, and Banking | Paid Applications agreement **Active**, bank + tax filled. IAP (sandbox included) does not work without it. |
| A2 | App → Monetization → Subscriptions | Create subscription group, e.g. `Solidarity Pro`; add en + zh-Hant group display name. |
| A3 | Same group → Create | Auto-renewable subscription. Reference name `Pro Yearly`, Product ID `gg.solidarity.pro.yearly`, duration **1 year**. |
| A4 | Subscription → Subscription Prices | Base price USD 36 (or nearest point); review the auto-generated TWD price. The app displays whatever the store returns. |
| A5 | Subscription → Localization | en + zh-Hant display name and description (matching the three Pro features). |
| A6 | Subscription → Review Information | Screenshot of the paywall (Settings → Plan) + review notes: how to reach it, that Restore is on the same screen. |
| A7 | Subscription → Family Sharing | Decide before launch — it cannot be turned off once enabled. Recommended: off for v1. |
| A8 | App Information | Privacy Policy URL; Terms of Use (standard Apple EULA link in the description, or a custom EULA). Both are also linked in-app. |
| A9 | Users and Access → Sandbox | Create sandbox tester(s) for device testing. |
| A10 | App version page | Attach the subscription to the next app version — a first subscription must ship with a new version submission. |
| A11 | *(bridge, later)* Users and Access → Integrations → In-App Purchase | Generate App Store Server API key → `.p8`, Key ID, Issuer ID. Store as worker secrets, never in the repo. |
| A12 | *(bridge, later)* App → App Store Server Notifications | V2 production + sandbox URL pointing at the worker. |

### Play Console

| # | Where | What |
|---|---|---|
| P1 | Setup → Payments profile | Merchant account active. |
| P2 | Testing → Internal testing | Upload an AAB built **with** `expo-iap` (its plugin adds `com.android.vending.BILLING`). Play may refuse product creation until such a build exists. |
| P3 | Monetize → Products → Subscriptions | Create Product ID `gg.solidarity.pro.yearly`; add en + zh-TW name/benefits. |
| P4 | That subscription → Base plan | Base plan ID **`yearly`** (must match `PRO_ANDROID_BASE_PLAN_ID`), auto-renewing, billing period **1 year**, price USD 36 + review local prices, **Activate**. Keep a single base plan (no offers) for v1 — the app passes this plan's offer token explicitly. |
| P5 | Setup → License testing | Add tester Gmail accounts so purchases are free test charges. |
| P6 | Internal testing → Testers | Same accounts opted in via the testing link. |
| P7 | *(bridge, later)* Google Cloud | Service account with Google Play Android Developer API enabled; invite it in Play Console → Users and permissions with *View financial data* + *Manage orders and subscriptions*. JSON key → worker secret. |
| P8 | *(bridge, later)* Monetize → Monetization setup | Real-time developer notifications Pub/Sub topic. |

## Remaining verification gates (not provable from unit tests)

1. **iOS dev client build** with `expo-iap` (`expo prebuild --clean` + `expo run:ios`), then a sandbox purchase, restore, and cancel on device.
2. **Android build** — `expo-iap`'s validated baseline is SDK 57 / RN 0.86; this app is SDK 56 / RN 0.85. Supported range, but a Kotlin
   conflict is possible; prove `expo run:android` before relying on it.
3. **Xcode Cloud archive** still green (new pod).

## License bridge — design sketch and open decisions

Flow: app signs `{did, platform, purchaseToken, productId, iat, aud}` with the root did:key (`signCompact`) → worker `POST /pro/license`
verifies the did JWS (`verifyCompact`), then the purchase (iOS: App Store Server API with the `.p8` JWT, same mechanism as `apns.ts`;
Android: Play Developer API `purchases.subscriptionsv2`) → records the purchase ↔ did binding in D1 → returns a creds.id-signed
license JWS `{sub: did, product, exp ≤ store expiry, iat}` that the app caches as `source: 'license'`.

Decisions needed before building it:

- **Q1 Rebinding.** One purchase, a second did (identity reset, or sharing). Refuse, allow N rebinds, or allow with cooldown?
- **Q2 How the renderer learns entitlement.** (a) Embed the license in the signed Page record — offline-verifiable, fits the north star,
  but changes the wire schema (`packages/shared` + `docs/ref/05`). (b) Public `GET /pro/status?did=` — simpler, but publicly reveals who pays.
- **Q3 Signing key.** Ed25519 service key as a worker secret; where its public key is pinned (app constant, web constant, `.well-known`), and rotation.
- **Q4 Scope.** Custom domain (D2 excludes it today) is the main thing the bridge unlocks — it needs its own routing design on creds.id.
