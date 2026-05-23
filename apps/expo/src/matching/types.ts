/**
 * Matching types — TS-friendly mirror of Swift ProximityPeer +
 * ProximityPeerStatus + PendingInvitation. Drives the matching UI
 * (cards, popups, sheets) without coupling to the Nitro proximity event
 * shape directly.
 *
 * Wire format: the Nitro layer emits a flattened `ProximityEvent` (see
 * nitro-modules/proximity/src/specs/Proximity.nitro.ts). The session
 * store collapses that stream into these higher-level structs.
 */
import type { Animal, SharingLevel } from '@solidarity/shared';

export type PeerStatus = 'disconnected' | 'connecting' | 'connected';

export type VerificationStatus =
  | 'verified'
  | 'pending'
  | 'unverified'
  | 'failed';

export interface MatchingPeer {
  readonly id: string;
  /** Stable peerID/endpoint string from the native layer. */
  readonly peerId: string;
  /** OS-level displayName (e.g. device name). */
  readonly displayName: string;
  /** Parsed discovery info — what the peer advertises about themselves. */
  readonly cardName?: string;
  readonly cardTitle?: string;
  readonly cardCompany?: string;
  readonly cardAnimal: Animal;
  readonly sharingLevel: SharingLevel;
  /** "zk" flag in discovery info — peer supports zero-knowledge proofs. */
  readonly zkReady: boolean;
  readonly status: PeerStatus;
  readonly verification?: VerificationStatus;
  /** Optional UWB distance in metres. */
  readonly distance?: number;
}

export interface PendingInvitation {
  readonly peerId: string;
  readonly receivedAt: number;
}

export type MatchingConnectionStatus =
  | 'disconnected'
  | 'advertising'
  | 'browsing'
  | 'advertisingAndBrowsing'
  | 'connected';

/** UWB spatial state for the OW-radar pill — mirrors UwbSpatialState. */
export type UwbSpatialState =
  | { kind: 'idle' }
  | { kind: 'approaching'; framesSeen: number; requiredFrames: number }
  | { kind: 'confirmed' }
  | { kind: 'exchanging' }
  | { kind: 'cooldown' };
