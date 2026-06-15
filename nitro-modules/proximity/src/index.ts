/**
 * @solidarity/nitro-proximity — public entrypoint.
 *
 * After `bunx nitrogen` + `pod install`, the generated HybridObject
 * adapter is auto-registered. `getProximity()` returns the iOS Swift impl
 * (HybridProximity.swift wrapping MultipeerConnectivity + NearbyInteraction)
 * or the Android Kotlin impl (Nearby Connections + UWB API 31+).
 */
import { NitroModules } from 'react-native-nitro-modules';

import type { Proximity } from './specs/Proximity.nitro';

export type {
  Proximity,
  ProximityPeer,
  ProximityEvent,
  ProximityEventKind,
  ProximityDirection,
} from './specs/Proximity.nitro';

let cached: Proximity | null = null;

export function getProximity(): Proximity {
  if (cached) return cached;
  cached = NitroModules.createHybridObject<Proximity>('Proximity');
  return cached;
}
