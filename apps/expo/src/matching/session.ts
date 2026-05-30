/**
 * Matching session — zustand store hosting peers, invitations, and the
 * advertise/browse lifecycle for the proximity matching flow.
 *
 * Wraps `@solidarity/nitro-proximity` so the React layer never reaches
 * into NitroModules directly. The native module is loaded lazily; on
 * platforms where it isn't registered yet (e.g. Expo Go, fresh Android
 * prebuild) the store no-ops and the UI stays interactive — same
 * approach the passport pipeline takes (mock flow until Nitro lands).
 *
 * Mirrors Swift ProximityManager.shared for `nearbyPeers`,
 * `connectionStatus`, `pendingInvitations`, `currentSharingLevel`.
 */
import { create } from 'zustand';

import { defaultAnimalForId, type SharingLevel } from '@solidarity/shared';

import type { ProximityTransport } from '@/settings/preferences';

import {
  type MatchingConnectionStatus,
  type MatchingPeer,
  type PendingInvitation,
  type PeerStatus,
  type UwbSpatialState,
} from './types';

const SERVICE_TYPE = 'solidarity-mp';
const INVITE_TIMEOUT_SEC = 25;

interface NitroPeerLike {
  readonly id: string;
  readonly displayName: string;
  readonly discoveryInfoJson: string;
  readonly distance?: number;
}

interface NitroEventLike {
  readonly kind: string;
  readonly peer?: NitroPeerLike;
  readonly peerId?: string;
  readonly distance?: number;
  readonly reason?: string;
  readonly errorMessage?: string;
  readonly errorCode?: string;
}

/**
 * Native error codes the iOS / Android Hybrid layer can raise. Mirrors
 * the `code` literals in nitro-modules/proximity/{ios,android}/
 * HybridProximity.*. The native side may add new codes, so the consumer
 * always sees a plain `string` — this set just powers the hint table.
 */
const FATAL_BLE_CODES = new Set<string>([
  'ble_state_invalid',
  'bluetooth_unsupported',
  'bluetooth_unauthorized',
  'bluetooth_not_ready',
  'ble_unavailable',
  'permission_denied',
]);

/**
 * Human-readable hint for the most common BLE failure modes. Returning
 * undefined for unknown codes keeps the upstream behaviour (we just show
 * `errorMessage` as-is).
 */
function describeBleError(code: string | undefined): string | undefined {
  switch (code) {
    case 'bluetooth_unsupported':
      return 'Bluetooth LE is not available on this device. Matching only works on a real iPhone or Android phone with Bluetooth.';
    case 'bluetooth_unauthorized':
    case 'permission_denied':
      return 'Bluetooth permission is required for nearby matching. Grant it in Settings to retry.';
    case 'ble_state_invalid':
    case 'bluetooth_not_ready':
    case 'ble_unavailable':
      return 'Bluetooth is off or not ready. Turn it on, then start matching again.';
    default:
      return undefined;
  }
}

/**
 * True for any code where there's no point retrying automatically — the
 * user has to toggle Bluetooth / grant permission / switch to a real
 * device before things can proceed.
 */
function isFatalBleCode(code: string | undefined): boolean {
  return code !== undefined && FATAL_BLE_CODES.has(code);
}

interface NitroProximityLike {
  startAdvertising(name: string, service: string, info: string): void;
  stopAdvertising(): void;
  startBrowsing(service: string): void;
  stopBrowsing(): void;
  invitePeer(peerId: string, payload: ArrayBuffer, timeoutSec: number): Promise<boolean>;
  acceptInvitation(peerId: string): void;
  rejectInvitation(peerId: string): void;
  sendData(peerId: string, data: ArrayBuffer): Promise<void>;
  disconnect(peerId: string): void;
  /**
   * Select the native transport. Optional because the Nitro spec doesn't
   * expose it yet — the legacy MultipeerConnectivity path is a pending native
   * port. The guarded call is a safe no-op until the spec gains the method,
   * at which point `multipeer` reaches the old Swift iOS app.
   */
  setTransportMode?(mode: string): void;
  addEventListener(handler: (event: NitroEventLike) => void): () => void;
}

let nitroCache: NitroProximityLike | null = null;
let nitroLoadFailed = false;

async function loadNitro(): Promise<NitroProximityLike | null> {
  if (nitroCache) return nitroCache;
  if (nitroLoadFailed) return null;
  try {
    // Dynamic import — keeps the store importable even when the native
    // module isn't linked (Expo Go, web preview).
    const mod = (await import('@solidarity/nitro-proximity')) as {
      getProximity?: () => NitroProximityLike;
    };
    if (typeof mod.getProximity !== 'function') {
      nitroLoadFailed = true;
      return null;
    }
    nitroCache = mod.getProximity();
    return nitroCache;
  } catch {
    nitroLoadFailed = true;
    return null;
  }
}

interface MatchingState {
  readonly peers: readonly MatchingPeer[];
  readonly connectionStatus: MatchingConnectionStatus;
  readonly isAdvertising: boolean;
  readonly isBrowsing: boolean;
  readonly sharingLevel: SharingLevel;
  readonly pendingInvitations: readonly PendingInvitation[];
  readonly latestMessage?: { content: string; timestamp: number };
  readonly receivedCardIds: readonly string[];
  readonly lastErrorMessage?: string;
  readonly infoMessage?: string;
  readonly uwbSpatial: UwbSpatialState;
  /** Selected proximity transport (mirrors the `proximityTransport` pref). */
  readonly transportMode: ProximityTransport;

  readonly startAdvertising: (
    displayName: string,
    level: SharingLevel,
    discoveryInfo?: Readonly<Record<string, string>>
  ) => Promise<void>;
  readonly stopAdvertising: () => Promise<void>;
  readonly startBrowsing: () => Promise<void>;
  readonly stopBrowsing: () => Promise<void>;
  readonly stopAll: () => Promise<void>;
  readonly connectToPeer: (peer: MatchingPeer) => Promise<void>;
  readonly cancelConnectionAttempt: (peer: MatchingPeer) => Promise<void>;
  readonly disconnectFromPeer: (peer: MatchingPeer) => Promise<void>;
  readonly acceptInvitation: (peerId: string) => Promise<void>;
  readonly declineInvitation: (peerId: string) => Promise<void>;
  readonly sendText: (text: string) => void;
  readonly sendSakura: () => void;
  readonly setSharingLevel: (level: SharingLevel) => void;
  readonly setTransportMode: (mode: ProximityTransport) => Promise<void>;
  readonly clearError: () => void;
}

function parseDiscovery(json: string): Readonly<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(json);
    if (raw && typeof raw === 'object') {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
  } catch {
    // Bad JSON from native side — treat as no metadata. The Swift app
    // does the same: a peer is still discoverable, just nameless.
  }
  return {};
}

function nitroToPeer(p: NitroPeerLike): MatchingPeer {
  const info = parseDiscovery(p.discoveryInfoJson);
  const level = (info['level'] as SharingLevel | undefined) ?? 'professional';
  const animalRaw = info['animal'];
  const animal =
    animalRaw === 'dog' ||
    animalRaw === 'horse' ||
    animalRaw === 'pig' ||
    animalRaw === 'sheep' ||
    animalRaw === 'dove'
      ? animalRaw
      : defaultAnimalForId(p.id);
  return {
    id: p.id,
    peerId: p.id,
    displayName: p.displayName,
    cardName: info['name'],
    cardTitle: info['title'],
    cardCompany: info['company'],
    cardAnimal: animal,
    sharingLevel: level,
    zkReady: info['zk'] === '1',
    status: 'disconnected',
    distance: p.distance,
  };
}

function updateStatus(
  peers: readonly MatchingPeer[],
  peerId: string,
  status: PeerStatus
): readonly MatchingPeer[] {
  return peers.map((p) => (p.peerId === peerId ? { ...p, status } : p));
}

function updateDistance(
  peers: readonly MatchingPeer[],
  peerId: string,
  distance: number | undefined
): readonly MatchingPeer[] {
  return peers.map((p) => (p.peerId === peerId ? { ...p, distance } : p));
}

function deriveConnectionStatus(
  isAdvertising: boolean,
  isBrowsing: boolean,
  peers: readonly MatchingPeer[]
): MatchingConnectionStatus {
  const anyConnected = peers.some((p) => p.status === 'connected');
  if (anyConnected) return 'connected';
  if (isAdvertising && isBrowsing) return 'advertisingAndBrowsing';
  if (isAdvertising) return 'advertising';
  if (isBrowsing) return 'browsing';
  return 'disconnected';
}

let unsubscribeListener: (() => void) | null = null;

async function ensureListener(set: (fn: (s: MatchingState) => Partial<MatchingState>) => void): Promise<void> {
  if (unsubscribeListener) return;
  const nitro = await loadNitro();
  if (!nitro) return;
  unsubscribeListener = nitro.addEventListener((event) => {
    handleNitroEvent(event, set);
  });
}

function handleNitroEvent(
  event: NitroEventLike,
  set: (fn: (s: MatchingState) => Partial<MatchingState>) => void
): void {
  switch (event.kind) {
    case 'peerFound':
      if (event.peer) {
        const peer = nitroToPeer(event.peer);
        set((s) => {
          const exists = s.peers.some((p) => p.peerId === peer.peerId);
          const next = exists
            ? s.peers.map((p) => (p.peerId === peer.peerId ? { ...peer, status: p.status } : p))
            : [...s.peers, peer];
          return {
            peers: next,
            connectionStatus: deriveConnectionStatus(s.isAdvertising, s.isBrowsing, next),
          };
        });
      }
      return;
    case 'peerLost': {
      const lostId = event.peerId;
      if (lostId) {
        set((s) => {
          const next = s.peers.filter((p) => p.peerId !== lostId);
          return {
            peers: next,
            connectionStatus: deriveConnectionStatus(s.isAdvertising, s.isBrowsing, next),
          };
        });
      }
      return;
    }
    case 'invitationReceived':
      if (event.peerId) {
        const invite: PendingInvitation = { peerId: event.peerId, receivedAt: Date.now() };
        set((s) => ({ pendingInvitations: [...s.pendingInvitations, invite] }));
      }
      return;
    case 'sessionEstablished': {
      const establishedId = event.peerId;
      if (establishedId) {
        set((s) => {
          const next = updateStatus(s.peers, establishedId, 'connected');
          return {
            peers: next,
            pendingInvitations: s.pendingInvitations.filter((i) => i.peerId !== establishedId),
            connectionStatus: deriveConnectionStatus(s.isAdvertising, s.isBrowsing, next),
          };
        });
      }
      return;
    }
    case 'sessionEnded': {
      const endedId = event.peerId;
      if (endedId) {
        set((s) => {
          const next = updateStatus(s.peers, endedId, 'disconnected');
          return {
            peers: next,
            connectionStatus: deriveConnectionStatus(s.isAdvertising, s.isBrowsing, next),
          };
        });
      }
      return;
    }
    case 'distanceUpdate': {
      const distId = event.peerId;
      if (distId) {
        const distance = event.distance;
        set((s) => ({
          peers: updateDistance(s.peers, distId, distance),
        }));
      }
      return;
    }
    case 'dataReceived': {
      // The card payload is decoded by the cards layer; here we just
      // surface a placeholder so the "View Latest Card" CTA becomes
      // active. Real decode happens in the cards repository.
      const cardPeerId = event.peerId;
      if (cardPeerId) {
        set((s) => ({ receivedCardIds: [...s.receivedCardIds, cardPeerId] }));
      }
      return;
    }
    case 'error': {
      const code = event.errorCode;
      const hint = describeBleError(code);
      const message = hint ?? event.errorMessage ?? 'Proximity error';
      const fatal = isFatalBleCode(code);
      set((s) => ({
        lastErrorMessage: message,
        // When BLE itself is unavailable, drop the advertising/browsing
        // intent so the radar UI stops spinning. The user has to toggle
        // Bluetooth (or move to a real device) and tap Start again —
        // we deliberately don't auto-retry to avoid a crash loop.
        isAdvertising: fatal ? false : s.isAdvertising,
        isBrowsing: fatal ? false : s.isBrowsing,
        connectionStatus: fatal
          ? deriveConnectionStatus(false, false, s.peers)
          : s.connectionStatus,
      }));
      return;
    }
    default:
      return;
  }
}

export const useMatchingSession = create<MatchingState>((set, get) => ({
  peers: [],
  connectionStatus: 'disconnected',
  isAdvertising: false,
  isBrowsing: false,
  sharingLevel: 'professional',
  pendingInvitations: [],
  receivedCardIds: [],
  uwbSpatial: { kind: 'idle' },
  transportMode: 'auto',

  startAdvertising: async (displayName, level, discoveryInfo) => {
    await ensureListener(set);
    const nitro = await loadNitro();
    set(() => ({ isAdvertising: true, sharingLevel: level }));
    if (nitro) {
      nitro.setTransportMode?.(get().transportMode);
      const info = JSON.stringify({ level, ...(discoveryInfo ?? {}) });
      nitro.startAdvertising(displayName, SERVICE_TYPE, info);
    }
    set((s) => ({
      connectionStatus: deriveConnectionStatus(true, s.isBrowsing, s.peers),
    }));
  },

  stopAdvertising: async () => {
    const nitro = await loadNitro();
    if (nitro) nitro.stopAdvertising();
    set((s) => ({
      isAdvertising: false,
      connectionStatus: deriveConnectionStatus(false, s.isBrowsing, s.peers),
    }));
  },

  startBrowsing: async () => {
    await ensureListener(set);
    const nitro = await loadNitro();
    set(() => ({ isBrowsing: true }));
    if (nitro) {
      nitro.setTransportMode?.(get().transportMode);
      nitro.startBrowsing(SERVICE_TYPE);
    }
    set((s) => ({
      connectionStatus: deriveConnectionStatus(s.isAdvertising, true, s.peers),
    }));
  },

  stopBrowsing: async () => {
    const nitro = await loadNitro();
    if (nitro) nitro.stopBrowsing();
    set((s) => ({
      isBrowsing: false,
      connectionStatus: deriveConnectionStatus(s.isAdvertising, false, s.peers),
    }));
  },

  stopAll: async () => {
    await get().stopAdvertising();
    await get().stopBrowsing();
  },

  connectToPeer: async (peer) => {
    // TODO(biometric-gate): prepend
    //   const gate = await requireSensitiveAction(
    //     'presentProof', 'Authorize a peer card exchange'
    //   );
    //   if (!gate.success) { set(...); return; }
    // so card exchanges obey the SensitiveAction policy. See
    // `src/keychain/biometricGatekeeper.ts`. Skipped today because the
    // concurrent agent owns this file.
    set((s) => ({ peers: updateStatus(s.peers, peer.peerId, 'connecting') }));
    const nitro = await loadNitro();
    if (!nitro) return;
    try {
      const empty = new ArrayBuffer(0);
      await nitro.invitePeer(peer.peerId, empty, INVITE_TIMEOUT_SEC);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invite failed';
      set((s) => ({
        peers: updateStatus(s.peers, peer.peerId, 'disconnected'),
        lastErrorMessage: message,
      }));
    }
  },

  cancelConnectionAttempt: async (peer) => {
    const nitro = await loadNitro();
    if (nitro) nitro.disconnect(peer.peerId);
    set((s) => ({ peers: updateStatus(s.peers, peer.peerId, 'disconnected') }));
  },

  disconnectFromPeer: async (peer) => {
    const nitro = await loadNitro();
    if (nitro) nitro.disconnect(peer.peerId);
    set((s) => ({
      peers: updateStatus(s.peers, peer.peerId, 'disconnected'),
      connectionStatus: deriveConnectionStatus(
        s.isAdvertising,
        s.isBrowsing,
        updateStatus(s.peers, peer.peerId, 'disconnected')
      ),
    }));
  },

  acceptInvitation: async (peerId) => {
    // TODO(biometric-gate): see connectToPeer above — same
    // `requireSensitiveAction('presentProof', ...)` gate applies here for
    // the inviter-accepts-card-exchange flow.
    const nitro = await loadNitro();
    if (nitro) nitro.acceptInvitation(peerId);
    set((s) => ({
      pendingInvitations: s.pendingInvitations.filter((i) => i.peerId !== peerId),
    }));
  },

  declineInvitation: async (peerId) => {
    const nitro = await loadNitro();
    if (nitro) nitro.rejectInvitation(peerId);
    set((s) => ({
      pendingInvitations: s.pendingInvitations.filter((i) => i.peerId !== peerId),
    }));
  },

  sendText: (text) => {
    set(() => ({
      latestMessage: { content: text, timestamp: Date.now() },
    }));
  },

  sendSakura: () => {
    set(() => ({
      latestMessage: { content: 'Sakura', timestamp: Date.now() },
    }));
  },

  setSharingLevel: (level) => {
    set(() => ({ sharingLevel: level }));
  },

  setTransportMode: async (mode) => {
    set(() => ({ transportMode: mode }));
    // Push to native if it's already running; the guarded call is a no-op
    // until the Nitro spec exposes setTransportMode (MC port pending).
    const nitro = await loadNitro();
    nitro?.setTransportMode?.(mode);
  },

  clearError: () => {
    set(() => ({ lastErrorMessage: undefined }));
  },
}));

/** Selector for "do we have any active matching session?" */
export const useIsMatchingActive = (): boolean =>
  useMatchingSession((s) => s.isAdvertising || s.isBrowsing);

/** Selector for connected peer count. */
export const useConnectedPeerCount = (): number =>
  useMatchingSession((s) => s.peers.filter((p) => p.status === 'connected').length);
