import { describe, expect, test } from 'bun:test';

import { androidProximityPermissions } from '../../src/matching/permissions';

/**
 * The runtime-permission policy is the fix for the "Android Start Matching
 * does nothing" bug: the manifest declares the BLE perms but Android 12+
 * still needs the runtime grant. We assert the exact set per OS level.
 */
describe('androidProximityPermissions', () => {
  test('API 31+ requests the "Nearby devices" Bluetooth runtime permissions', () => {
    expect(androidProximityPermissions(31)).toEqual([
      'android.permission.BLUETOOTH_ADVERTISE',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.BLUETOOTH_SCAN',
    ]);
  });

  test('newer API levels keep the Bluetooth perms and never request location', () => {
    const perms = androidProximityPermissions(34);
    expect(perms).toContain('android.permission.BLUETOOTH_SCAN');
    expect(perms).not.toContain('android.permission.ACCESS_FINE_LOCATION');
  });

  test('API < 31 falls back to fine location (legacy BLE scan gate)', () => {
    expect(androidProximityPermissions(30)).toEqual([
      'android.permission.ACCESS_FINE_LOCATION',
    ]);
    expect(androidProximityPermissions(26)).toEqual([
      'android.permission.ACCESS_FINE_LOCATION',
    ]);
  });
});
