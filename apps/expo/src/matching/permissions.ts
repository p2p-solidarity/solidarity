/**
 * Proximity permissions — runtime grant for the BLE/UWB matching transport.
 *
 * Why this exists: the Android proximity Nitro module (BLE advertise/scan +
 * L2CAP) throws `SecurityException` the moment it touches CoreBluetooth/
 * BluetoothAdapter without the runtime grant, which the session swallows into
 * `lastErrorMessage`. The visible symptom is a dead "Start Matching" button on
 * Android (the manifest declares the perms, but Android 12+ still requires the
 * user to grant the "Nearby devices" group at runtime).
 *
 * iOS needs nothing here: CoreBluetooth + NearbyInteraction present their own
 * system prompts on first use, so we resolve `granted` and let the OS ask.
 *
 * `react-native` is imported lazily inside the request so the pure
 * `androidProximityPermissions` policy stays unit-testable without pulling RN
 * (Bun's loader trips on RN's flow syntax — same reason the cards layer
 * lazy-loads its native deps).
 */

// Type-only import — erased at build time, so it never loads react-native at
// runtime (the runtime load happens via require() inside the request below).
import type * as ReactNative from 'react-native';

export type ProximityPermissionResult =
  | { readonly granted: true }
  | {
      readonly granted: false;
      readonly reason: 'denied' | 'unavailable';
      readonly missing: readonly string[];
    };

/**
 * The Android runtime permissions the proximity transport needs for the
 * running OS level.
 *   - API 31+ (Android 12): the dedicated "Nearby devices" Bluetooth runtime
 *     permissions. Location is NOT required for a `neverForLocation` scan.
 *   - API < 31: classic BLE scanning is gated behind fine location.
 * Pure + side-effect free so it can be exercised without react-native.
 */
export function androidProximityPermissions(apiLevel: number): readonly string[] {
  if (apiLevel >= 31) {
    return [
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
    ];
  }
  return ['android.permission.ACCESS_FINE_LOCATION'];
}

/**
 * Request the platform proximity permissions before advertising/browsing.
 * Returns `granted` on iOS (system prompts later) and on a fully-granted
 * Android request; otherwise reports which permissions are still missing so
 * the caller can show an honest "Bluetooth permission needed" state instead of
 * a silently-dead button.
 */
export async function ensureProximityPermissions(): Promise<ProximityPermissionResult> {
  // Load react-native lazily (kept out of static imports so the pure
  // `androidProximityPermissions` helper above stays unit-testable without RN).
  //
  // IMPORTANT: use require(), NOT `await import('react-native')`. A dynamic
  // wildcard import makes Metro run `metroImportAll` over EVERY react-native
  // export, which invokes the deprecated `PushNotificationIOS` getter →
  // `new NativeEventEmitter(NativeModules.PushNotificationManager)`. This app
  // ships expo-notifications, so RCTPushNotificationManager is NOT linked, the
  // argument is null, and RN throws an uncaught "Invariant Violation:
  // `new NativeEventEmitter()` requires a non-null argument" that hard-crashes
  // the app on the first proximity tap (iOS + Android). require() only touches
  // the two members we destructure, never PushNotificationIOS.
  const { PermissionsAndroid, Platform } = require('react-native') as typeof ReactNative;
  if (Platform.OS !== 'android') return { granted: true };

  const apiLevel =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : Number.parseInt(String(Platform.Version), 10) || 0;
  const needed = androidProximityPermissions(apiLevel);

  try {
    const result = await PermissionsAndroid.requestMultiple(
      needed as Parameters<typeof PermissionsAndroid.requestMultiple>[0]
    );
    const granted = PermissionsAndroid.RESULTS.GRANTED;
    const missing = needed.filter(
      (perm) => result[perm as keyof typeof result] !== granted
    );
    if (missing.length === 0) return { granted: true };
    return { granted: false, reason: 'denied', missing };
  } catch {
    // Adapter missing / API shape changed — surface as unavailable so the UI
    // can render "Bluetooth not available" rather than spin forever.
    return { granted: false, reason: 'unavailable', missing: needed };
  }
}
