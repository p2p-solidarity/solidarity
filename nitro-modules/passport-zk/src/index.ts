/**
 * @solidarity/nitro-passport-zk — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject
 * adapter is auto-registered. `passportZk` returns the iOS Swift impl
 * (HybridPassportZk.swift) or the Android Kotlin impl when on-device.
 *
 * In tests or web bundles `NitroModules.createHybridObject` returns
 * `null`; consumers should fall back to the Semaphore / SD-JWT path
 * the Swift app already uses (MoproProofService+Fallbacks).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { PassportZk } from './specs/PassportZk.nitro';

export type {
  PassportZk,
  NoirProofResult,
} from './specs/PassportZk.nitro';

let cached: PassportZk | null = null;

/** Returns the singleton HybridObject (lazy + cached). */
export function getPassportZk(): PassportZk {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<PassportZk>('PassportZk');
  return cached;
}
