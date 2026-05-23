/**
 * @solidarity/nitro-spruce-did — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject adapter
 * is auto-registered. `getSpruceDid()` returns the iOS Swift impl
 * (HybridSpruceDid.swift wrapping SpruceIDMobileSdkRs + Secure Enclave) or
 * the Android Kotlin impl (com.spruceid.mobile.sdk + AndroidKeyStore).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { SpruceDid } from './specs/SpruceDid.nitro';

export type {
  SpruceDid,
  SpruceDidEvent,
  SpruceDidEventKind,
} from './specs/SpruceDid.nitro';

let cached: SpruceDid | null = null;

export function getSpruceDid(): SpruceDid {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<SpruceDid>('SpruceDid');
  return cached;
}
