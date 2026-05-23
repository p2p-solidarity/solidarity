/**
 * Nitro spec — proximity (P2P + UWB)
 *
 * Unified abstraction over:
 *   iOS    : MultipeerConnectivity (peers) + NearbyInteraction (UWB ranging)
 *   Android: Nearby Connections API (peers) + UWB API 31+ (ranging),
 *            BLE RSSI fallback for older devices
 *
 * Mirrors the Swift ProximityManager + NearbyInteractionManager surface;
 * see docs/migration/02-services-inventory.md for the full method map.
 *
 * Event-stream pattern: addEventListener returns an unsubscribe callback.
 * Heavy state transitions emit a single event payload so the JS layer can
 * keep a Zustand store in sync without polling.
 *
 * NOTE: this file is on the JS↔Native boundary, so `any`-style payloads
 * are allowed by the eslint override on nitro-modules/**/specs.
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface ProximityPeer {
  /** Session-stable identifier (MCPeerID / EndpointId / UWB token). */
  readonly id: string;
  readonly displayName: string;
  /** Discovery-time metadata (e.g. did, animal, app version). */
  readonly discoveryInfo: Readonly<Record<string, string>>;
  /** BLE RSSI in dBm (Android fallback only). */
  readonly rssi?: number;
  /** Last measured distance in metres (UWB). */
  readonly distance?: number;
  /** Direction unit vector (UWB; iOS only on most devices). */
  readonly direction?: Readonly<{ x: number; y: number; z: number }>;
}

export type ProximityEvent =
  | { readonly type: 'peerFound'; readonly peer: ProximityPeer }
  | { readonly type: 'peerLost'; readonly peerId: string }
  | {
      readonly type: 'invitationReceived';
      readonly peerId: string;
      readonly payload: ArrayBuffer;
    }
  | { readonly type: 'sessionEstablished'; readonly peerId: string }
  | {
      readonly type: 'sessionEnded';
      readonly peerId: string;
      readonly reason: string;
    }
  | {
      readonly type: 'dataReceived';
      readonly peerId: string;
      readonly data: ArrayBuffer;
    }
  | {
      readonly type: 'distanceUpdate';
      readonly peerId: string;
      readonly distance: number;
      readonly direction?: Readonly<{ x: number; y: number; z: number }>;
    }
  | { readonly type: 'error'; readonly message: string; readonly code: string };

export interface Proximity
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  startAdvertising(
    displayName: string,
    serviceType: string,
    info: Readonly<Record<string, string>>
  ): void;
  stopAdvertising(): void;

  startBrowsing(serviceType: string): void;
  stopBrowsing(): void;

  invitePeer(
    peerId: string,
    payload: ArrayBuffer,
    timeoutSec: number
  ): Promise<boolean>;
  acceptInvitation(peerId: string): void;
  rejectInvitation(peerId: string): void;

  sendData(peerId: string, data: ArrayBuffer): Promise<void>;
  disconnect(peerId: string): void;

  /** UWB ranging — NearbyInteraction (iOS 14.3+) / UWB API 31+ (Android). */
  startRanging(peerId: string): Promise<void>;
  stopRanging(peerId: string): void;

  /** Returns an unsubscribe function. */
  addEventListener(handler: (event: ProximityEvent) => void): () => void;
}
