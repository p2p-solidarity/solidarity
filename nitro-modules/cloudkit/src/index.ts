/**
 * @solidarity/nitro-cloudkit — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject adapter
 * is auto-registered. `getCloudKit()` returns the iOS Swift impl
 * (HybridCloudKit.swift wrapping CloudKit framework) or the Android Kotlin
 * impl (HybridCloudKit.kt wrapping Google Drive REST).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { CloudKit } from './specs/CloudKit.nitro';

export type {
  CloudKit,
  CloudKitRecord,
  CloudKitShareInvite,
  CloudKitEvent,
  CloudKitEventKind,
} from './specs/CloudKit.nitro';

let cached: CloudKit | null = null;

export function getCloudKit(): CloudKit {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<CloudKit>('CloudKit');
  return cached;
}
