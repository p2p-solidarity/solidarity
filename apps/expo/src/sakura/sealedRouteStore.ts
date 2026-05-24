/**
 * Sakura sealed-route persistence — zustand-backed cache for the device
 * token + the `/v1/seal` envelope the relay returns.
 *
 * Mirrors Swift `SecureKeyManager.mySealedRoute` (UserDefaults-backed) plus
 * the device-token snapshot the Swift AppDelegate keeps in flight.
 *
 * Pattern: same as `src/settings/preferences.ts` — start in-memory with
 * `DEFAULTS` so reads pre-`initMmkv()` don't crash, then hydrate on first
 * access via a lazy `readSafe()` call. Writes swallow MMKV errors so a
 * not-yet-ready store never crashes the registration flow.
 */
import { create } from 'zustand';

import { getMmkv } from '@/storage/mmkv';
import type { SealResponse } from '@solidarity/shared';

const KEY = 'gg.solidarity.sakura.route.v1';

export interface SealedRouteSnapshot {
  /** Raw APNs / FCM device token. */
  readonly deviceToken?: string;
  /** Server-returned sealed (blind) route from a prior `/v1/seal` exchange. */
  readonly sealedRoute?: SealResponse;
  /** Unix epoch ms when we last persisted a sealed route. */
  readonly lastRegisteredAt?: number;
}

const DEFAULTS: SealedRouteSnapshot = {};

function readSafe(): SealedRouteSnapshot {
  try {
    const raw = getMmkv().getString(KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SealedRouteSnapshot>) };
  } catch {
    return DEFAULTS;
  }
}

function writeSafe(s: SealedRouteSnapshot): void {
  try {
    getMmkv().set(KEY, JSON.stringify(s));
  } catch {
    // MMKV not ready / disk full — fail closed; the live in-memory state
    // remains authoritative for this app session.
  }
}

function clearSafe(): void {
  try {
    getMmkv().remove(KEY);
  } catch {
    // Same rationale as writeSafe — best-effort.
  }
}

interface SealedRouteState extends SealedRouteSnapshot {
  readonly persist: (token: string, route: SealResponse) => void;
  readonly clear: () => void;
  readonly getRoute: () => SealResponse | undefined;
}

export const useSealedRouteStore = create<SealedRouteState>((set, get) => ({
  ...DEFAULTS,
  persist: (deviceToken, sealedRoute) => {
    const next: SealedRouteSnapshot = {
      deviceToken,
      sealedRoute,
      lastRegisteredAt: Date.now(),
    };
    writeSafe(next);
    set(next);
  },
  clear: () => {
    clearSafe();
    set(DEFAULTS);
  },
  getRoute: () => get().sealedRoute,
}));

/**
 * Swap the in-memory defaults for the persisted snapshot. Call once from the
 * root layout (or lazily from `registerForPushNotificationsAsync`) after
 * `initMmkv()` resolves.
 */
export function hydrateSealedRoute(): void {
  useSealedRouteStore.setState(readSafe());
}
