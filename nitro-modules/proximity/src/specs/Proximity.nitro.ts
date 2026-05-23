/**
 * Nitro spec — proximity (P2P + UWB)
 *
 * Unified abstraction over:
 *   iOS    : MultipeerConnectivity (peers) + NearbyInteraction (UWB ranging)
 *   Android: Google Nearby Connections API (peers) + UWB API 31+ (ranging),
 *            BLE RSSI fallback for older devices
 *
 * Event shape: a single `ProximityEvent` struct with all optional fields
 * + a `kind` enum string. Nitrogen rejects discriminated unions with
 * string literal discriminators, so we use this flattened shape and let
 * the consumer narrow with the runtime `kind` check.
 */
import type { HybridObject } from 'react-native-nitro-modules';

export interface ProximityDirection {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ProximityPeer {
  /** Session-stable identifier (MCPeerID / EndpointId / UWB token). */
  readonly id: string;
  readonly displayName: string;
  /** JSON-stringified discovery metadata (did, animal, app version). */
  readonly discoveryInfoJson: string;
  /** BLE RSSI in dBm (Android fallback only). */
  readonly rssi?: number;
  /** Last measured distance in metres (UWB). */
  readonly distance?: number;
  /** Direction unit vector (UWB; iOS only on most devices). */
  readonly direction?: ProximityDirection;
}

export type ProximityEventKind =
  | 'peerFound'
  | 'peerLost'
  | 'invitationReceived'
  | 'sessionEstablished'
  | 'sessionEnded'
  | 'dataReceived'
  | 'distanceUpdate'
  | 'error';

export interface ProximityEvent {
  readonly kind: ProximityEventKind;
  /** Populated for peerFound. */
  readonly peer?: ProximityPeer;
  /** Populated for peerLost / invitationReceived / session* / dataReceived / distanceUpdate. */
  readonly peerId?: string;
  /** Populated for invitationReceived. */
  readonly payload?: ArrayBuffer;
  /** Populated for sessionEnded. */
  readonly reason?: string;
  /** Populated for dataReceived. */
  readonly data?: ArrayBuffer;
  /** Populated for distanceUpdate. */
  readonly distance?: number;
  readonly direction?: ProximityDirection;
  /** Populated for error. */
  readonly errorMessage?: string;
  readonly errorCode?: string;
}

export interface Proximity
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  startAdvertising(
    displayName: string,
    serviceType: string,
    discoveryInfoJson: string
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
