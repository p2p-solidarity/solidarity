/**
 * Sakura push registration — mirrors Swift `AppDelegate` APNs path.
 *
 * Flow (1:1 with Swift AppDelegate.didRegisterForRemoteNotifications):
 *   1. Ask the OS for notification permission (alert / sound / badge).
 *      Decline is non-fatal — Swift simply skips registration without
 *      raising, so we do the same.
 *   2. Fetch the native APNs / FCM device token via
 *      `Notifications.getDevicePushTokenAsync()`. On iOS that is the APNs
 *      hex string; on Android, the FCM token. Both are sent to the relay
 *      verbatim — the relay decides which transport to use based on its
 *      own platform routing.
 *   3. Exchange the token for a sealed (blind) route via `sealToken`.
 *   4. Persist the (token, sealedRoute) pair through `useSealedRouteStore`
 *      so future renders + sends can reuse it without another round trip.
 *
 * Idempotence: if a previous registration is fresher than `STALE_AFTER_MS`
 * AND the token hasn't changed, we short-circuit — important because Expo
 * re-fires the layout-effect on every cold start, and we don't want to
 * hammer the relay's `/v1/seal` endpoint on every launch.
 */
import * as Notifications from 'expo-notifications';

import type { SealResponse } from '@solidarity/shared';

import { sealToken } from './client';
import {
  hydrateSealedRoute,
  useSealedRouteStore,
} from './sealedRouteStore';

/** A sealed route older than this is considered stale and re-registered. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface PushRegistration {
  readonly token: string;
  readonly sealed: SealResponse;
}

async function requestPermission(): Promise<boolean> {
  const result = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });
  if (result.granted) return true;
  // iOS may return `granted: false` but a provisional iOS status — accept
  // either as "we can deliver notifications".
  if (result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
    return true;
  }
  return false;
}

/**
 * Acquire the OS-level push token. Returns `null` when the platform doesn't
 * surface one (web simulator, simulator without APNs cert, etc.) so callers
 * can tolerate the failure the same way Swift does (#if targetEnvironment).
 */
async function fetchDeviceToken(): Promise<string | null> {
  try {
    const tok = await Notifications.getDevicePushTokenAsync();
    if (typeof tok.data === 'string' && tok.data.length > 0) {
      return tok.data;
    }
    return null;
  } catch {
    // Simulator / missing entitlement — Swift logs this and bails too.
    return null;
  }
}

/**
 * Register for remote push, exchange the device token for a sealed route,
 * and persist the result.
 *
 * Returns the registration payload on success, or `null` if any step
 * declined (permission denied / no token available). Throws only on
 * unexpected relay failures, which the caller can swallow + retry.
 */
export async function registerForPushNotificationsAsync(): Promise<PushRegistration | null> {
  // Pull the latest persisted snapshot into the store so the freshness check
  // below has accurate data on the very first call after boot.
  hydrateSealedRoute();

  const granted = await requestPermission();
  if (!granted) return null;

  const token = await fetchDeviceToken();
  if (!token) return null;

  const snapshot = useSealedRouteStore.getState();
  if (
    snapshot.deviceToken === token &&
    snapshot.sealedRoute &&
    snapshot.lastRegisteredAt &&
    Date.now() - snapshot.lastRegisteredAt < STALE_AFTER_MS
  ) {
    return { token, sealed: snapshot.sealedRoute };
  }

  const sealed = await sealToken(token);
  useSealedRouteStore.getState().persist(token, sealed);
  return { token, sealed };
}

/**
 * Tear down: drop the sealed route from cache and ask the OS to unregister
 * for remote notifications. Mirrors Swift
 * `didFailToRegisterForRemoteNotifications` (clear stale route) plus the
 * settings-screen "disable notifications" path.
 */
export async function unregister(): Promise<void> {
  useSealedRouteStore.getState().clear();
  try {
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Best-effort — Android implementations may no-op; not worth surfacing.
  }
}
