/**
 * Sakura push registration — mirrors Swift `AppDelegate` APNs path.
 *
 * Flow:
 *   1. Confirm we may deliver: the automatic (cold-launch / token-change)
 *      path checks the EXISTING OS permission status and NEVER prompts — a
 *      user who has not opted in must not see a surprise system dialog.
 *      Only an explicit user action (toggling Remote Notifications ON in
 *      Settings) passes `{ prompt: true }`, which is allowed to raise the
 *      one OS permission request.
 *   2. Fetch the native APNs / FCM device token via
 *      `Notifications.getDevicePushTokenAsync()`. On iOS that is the APNs
 *      hex string; on Android, the FCM token. Both are sent to the relay
 *      verbatim — the relay decides which transport to use based on its
 *      own platform routing.
 *   3. Exchange the token for a sealed (blind) route via `sealToken`.
 *   4. Persist the (token, sealedRoute) pair through `useSealedRouteStore`
 *      so future renders + sends can reuse it without another round trip.
 *
 * Opt-in gate (R25): the caller (`app/_layout.tsx`) only ever invokes the
 * automatic path once the persisted `notificationsRemote` preference is
 * hydrated AND enabled, and toggling the preference OFF calls `unregister()`.
 *
 * Idempotence: if a previous registration is fresher than `STALE_AFTER_MS`
 * AND the token hasn't changed, we short-circuit — important because Expo
 * re-fires the layout-effect on every cold start, and we don't want to
 * hammer the relay's `/v1/seal` endpoint on every launch. Concurrent
 * automatic calls (cold launch racing the push-token listener) are
 * additionally coalesced into a single relay round-trip (single-flight).
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

export interface RegisterPushOptions {
  /**
   * Whether this call may raise the OS permission prompt. `false` (default)
   * is the automatic path: it registers ONLY if permission is already
   * granted and otherwise bails silently, so a user who never opted in is
   * never prompted. `true` is reserved for the explicit opt-in action in
   * Settings.
   */
  readonly prompt?: boolean;
}

/**
 * Whether the OS will currently deliver remote notifications WITHOUT asking
 * — i.e. permission was already granted (or provisionally granted on iOS).
 * Never raises a prompt: this is a status read, not a request.
 */
async function hasDeliveryPermission(): Promise<boolean> {
  try {
    const status = await Notifications.getPermissionsAsync();
    if (status.granted) return true;
    if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) {
      return true;
    }
    return false;
  } catch {
    // No native module (simulator / tests) — treat as "cannot deliver".
    return false;
  }
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

/** In-flight automatic registration, so a cold-launch call and a
 * push-token-change call never fan out into two `/v1/seal` round-trips. */
let inFlightAuto: Promise<PushRegistration | null> | null = null;

/**
 * Register for remote push, exchange the device token for a sealed route,
 * and persist the result.
 *
 * Returns the registration payload on success, or `null` if any step
 * declined (not opted in / permission not granted / no token available).
 * Throws only on unexpected relay failures, which the caller can swallow +
 * retry.
 *
 * Pass `{ prompt: true }` ONLY from the explicit Settings opt-in — that is
 * the sole path allowed to raise the OS permission dialog. The default
 * (automatic) path registers silently when permission already exists and
 * otherwise returns `null` without prompting.
 */
export function registerForPushNotificationsAsync(
  options: RegisterPushOptions = {}
): Promise<PushRegistration | null> {
  const prompt = options.prompt === true;

  // Single-flight the automatic path only. An explicit prompt request must
  // not ride on (or be coalesced by) a silent in-flight call, so it always
  // runs fresh.
  if (!prompt && inFlightAuto) return inFlightAuto;

  const run = doRegister(prompt);
  if (!prompt) {
    inFlightAuto = run;
    // Settled-either-way cleanup via `then(onOk, onErr)`, NOT `.finally()`:
    // `.finally()` returns a NEW promise that re-rejects with the same
    // reason, and that derived promise has no handler — so a relay failure
    // (e.g. an unconfigured EXPO_PUBLIC_SAKURA_API_URL) surfaced as an
    // unhandled rejection even though every caller catches `run` itself.
    const clear = (): void => {
      if (inFlightAuto === run) inFlightAuto = null;
    };
    run.then(clear, clear);
  }
  return run;
}

async function doRegister(prompt: boolean): Promise<PushRegistration | null> {
  // Pull the latest persisted snapshot into the store so the freshness check
  // below has accurate data on the very first call after boot.
  hydrateSealedRoute();

  // Check the EXISTING permission before ever requesting. If it is not
  // already granted, only an explicit opt-in (`prompt`) may raise the OS
  // dialog; the automatic path bails silently so nobody is surprised.
  if (!(await hasDeliveryPermission())) {
    if (!prompt) return null;
    const granted = await requestPermission();
    if (!granted) return null;
  }

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
