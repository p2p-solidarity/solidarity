/**
 * UWB Bump driver — drives the `UwbSpatialState` machine from Nitro
 * `distanceUpdate` / `peerFound` events and fires the NFC-tap-feel
 * haptic + visual + auto-invite gestures.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §3.3.1 (UX), §13.4 (platform
 * driver split), §13.5 (consent rules).
 *
 * Sandbox-only: register via `createBumpDriver()` from sandbox screens.
 * The production Share tab still uses the manual tap-to-connect flow in
 * `useMatchingSession`. Two parallel listeners on the same Nitro stream
 * are safe — neither side mutates the other's state.
 *
 * No fake data: a driver is dormant until it ingests a real `distance`
 * or `rssi` value from a real peer. Use `simulateProgression()` for
 * tests / the Lab "Test bump (simulate)" button — that path is clearly
 * labelled in the Lab UI so a screenshot can never be mistaken for a
 * real exchange.
 */
import type { UwbSpatialState } from './types';

/** Haptic intensities the driver requests on state transitions. */
export type BumpHapticKind = 'soft' | 'heavy' | 'success';

/** Which sensor produced the proximity signal — drives the consent gate. */
export type ProximitySignalSource = 'uwb' | 'rssi';

export type BumpReason = 'rssi' | 'sameSession' | 'alwaysConfirm';

export type BumpEvent =
  | { readonly kind: 'stateChanged'; readonly peerId: string; readonly state: UwbSpatialState }
  | { readonly kind: 'flashRequested'; readonly peerId: string }
  | { readonly kind: 'consentSheetRequested'; readonly peerId: string; readonly reason: BumpReason }
  | { readonly kind: 'autoInvite'; readonly peerId: string }
  | {
      readonly kind: 'transitionLog';
      readonly peerId: string;
      readonly from: UwbSpatialState['kind'];
      readonly to: UwbSpatialState['kind'];
      readonly signal: ProximitySignalSource;
      readonly distanceM?: number;
      readonly rssiDbm?: number;
      readonly note: string;
    };

/** Distance / RSSI thresholds — per docs §3.3.1 pseudocode. */
export const BUMP_CLOSE_DISTANCE_M = 0.10;
export const BUMP_FAR_DISTANCE_M = 0.30;
export const BUMP_CLOSE_RSSI_DBM = -50;
export const BUMP_FAR_RSSI_DBM = -70;
export const BUMP_REQUIRED_CLOSE_FRAMES = 3;
export const BUMP_COOLDOWN_MS = 2000;

interface PeerStateSlot {
  state: UwbSpatialState;
  /** Locked once the first non-null signal arrives. UWB wins if both. */
  signalSource: ProximitySignalSource | null;
  cooldownTimer: ReturnType<typeof setTimeout> | null;
  lastDistanceM?: number;
  lastRssiDbm?: number;
}

export interface BumpDriverConfig {
  /** When on, even UWB peers go through the 3-second consent sheet. */
  readonly alwaysConfirm: boolean;
  /** Receiver of every driver event (UI hook → state machine view, flash, sheet). */
  readonly onEvent: (event: BumpEvent) => void;
  /** Auto-invite hook — production calls into the proximity store; the Lab simulate hands a noop. */
  readonly invitePeer: (peerId: string) => Promise<void> | void;
  /** Haptic dispatcher — production wires to `@/feedback/haptics`, tests stub. */
  readonly onHaptic?: (kind: BumpHapticKind) => void;
  /** Override the cooldown duration (tests). */
  readonly cooldownMs?: number;
}

export interface BumpDriver {
  /** Feed a Nitro `distanceUpdate` event (UWB path). */
  ingestDistanceUpdate(peerId: string, distanceM: number): void;
  /** Feed a Nitro `peerFound` RSSI (Android / pre-U1 iOS path). */
  ingestRssi(peerId: string, rssiDbm: number): void;
  /** Called when proximity reports `sessionEstablished` / `dataReceived` / `sessionEnded`. */
  notifySessionEvent(peerId: string, kind: 'established' | 'dataReceived' | 'ended'): void;
  /** Inspect the current per-peer state. */
  peerState(peerId: string): UwbSpatialState;
  /** Snapshot of every peer the driver has ever seen this session. */
  allPeers(): readonly { readonly peerId: string; readonly state: UwbSpatialState; readonly source: ProximitySignalSource | null }[];
  /** Lab escape hatch — force a peer back to `idle` (clears cooldown). */
  forceIdle(peerId: string): void;
  /** Lab escape hatch — manually mark `cooldown` (used after a consent sheet accept). */
  forceCooldown(peerId: string): void;
  /** Clear the same-session "already auto-invited" set — call when Start Matching toggles off. */
  resetSessionMemory(): void;
  /** Walk through a scripted distance sequence with the spec's frame cadence. Lab + tests only. */
  simulateProgression(
    peerId: string,
    source: ProximitySignalSource,
    sequence: readonly number[],
    stepMs?: number
  ): Promise<void>;
}

export function createBumpDriver(config: BumpDriverConfig): BumpDriver {
  const peers = new Map<string, PeerStateSlot>();
  const alreadyAutoInvited = new Set<string>();
  const cooldownMs = config.cooldownMs ?? BUMP_COOLDOWN_MS;
  const fireHaptic = (kind: BumpHapticKind): void => {
    try {
      config.onHaptic?.(kind);
    } catch {
      // Haptics aren't critical; never let a UI dispatcher crash the driver.
    }
  };

  function slotFor(peerId: string): PeerStateSlot {
    let ps = peers.get(peerId);
    if (!ps) {
      ps = { state: { kind: 'idle' }, signalSource: null, cooldownTimer: null };
      peers.set(peerId, ps);
    }
    return ps;
  }

  function emit(event: BumpEvent): void {
    try {
      config.onEvent(event);
    } catch {
      // UI listener should not crash the driver. Swallowing is intentional;
      // a failing UI doesn't change the state machine's correctness.
    }
  }

  function transition(
    peerId: string,
    next: UwbSpatialState,
    note: string,
    signal: ProximitySignalSource | null,
    distanceM: number | undefined,
    rssiDbm: number | undefined
  ): void {
    const ps = slotFor(peerId);
    if (ps.cooldownTimer) {
      clearTimeout(ps.cooldownTimer);
      ps.cooldownTimer = null;
    }
    const prev = ps.state;
    ps.state = next;
    emit({ kind: 'stateChanged', peerId, state: next });
    if (signal !== null) {
      emit({
        kind: 'transitionLog',
        peerId,
        from: prev.kind,
        to: next.kind,
        signal,
        ...(typeof distanceM === 'number' ? { distanceM } : {}),
        ...(typeof rssiDbm === 'number' ? { rssiDbm } : {}),
        note,
      });
    }
  }

  function applySignal(
    peerId: string,
    source: ProximitySignalSource,
    distanceM: number | undefined,
    rssiDbm: number | undefined
  ): void {
    const ps = slotFor(peerId);
    // Lock the signal source on first sighting. UWB wins if it ever
    // arrives — even after an RSSI-only start — because UWB is the
    // higher-precision sensor and we want auto-invite once available.
    if (ps.signalSource === null) {
      ps.signalSource = source;
    } else if (source === 'uwb' && ps.signalSource === 'rssi') {
      ps.signalSource = 'uwb';
    }
    if (typeof distanceM === 'number') ps.lastDistanceM = distanceM;
    if (typeof rssiDbm === 'number') ps.lastRssiDbm = rssiDbm;

    const isClose =
      source === 'uwb'
        ? typeof distanceM === 'number' && distanceM < BUMP_CLOSE_DISTANCE_M
        : typeof rssiDbm === 'number' && rssiDbm > BUMP_CLOSE_RSSI_DBM;
    const isFar =
      source === 'uwb'
        ? typeof distanceM === 'number' && distanceM > BUMP_FAR_DISTANCE_M
        : typeof rssiDbm === 'number' && rssiDbm < BUMP_FAR_RSSI_DBM;

    const state = ps.state;
    switch (state.kind) {
      case 'idle': {
        if (typeof distanceM !== 'number' && typeof rssiDbm !== 'number') return;
        transition(
          peerId,
          {
            kind: 'approaching',
            framesSeen: isClose ? 1 : 0,
            requiredFrames: BUMP_REQUIRED_CLOSE_FRAMES,
          },
          'first signal',
          source,
          distanceM,
          rssiDbm
        );
        fireHaptic('soft');
        return;
      }
      case 'approaching': {
        if (isFar) {
          transition(peerId, { kind: 'idle' }, 'pulled away', source, distanceM, rssiDbm);
          return;
        }
        if (!isClose) {
          // Mid-range tick — stay approaching, do not advance framesSeen
          // (advancing on noise causes ghost taps).
          return;
        }
        const nextFrames = state.framesSeen + 1;
        if (nextFrames >= state.requiredFrames) {
          transition(peerId, { kind: 'confirmed' }, 'frames threshold met', source, distanceM, rssiDbm);
          fireHaptic('heavy');
          emit({ kind: 'flashRequested', peerId });
          const needsSheet =
            ps.signalSource === 'rssi' ||
            alreadyAutoInvited.has(peerId) ||
            config.alwaysConfirm;
          if (needsSheet) {
            const reason: BumpReason =
              ps.signalSource === 'rssi'
                ? 'rssi'
                : alreadyAutoInvited.has(peerId)
                  ? 'sameSession'
                  : 'alwaysConfirm';
            emit({ kind: 'consentSheetRequested', peerId, reason });
          } else {
            alreadyAutoInvited.add(peerId);
            emit({ kind: 'autoInvite', peerId });
            void Promise.resolve(config.invitePeer(peerId)).catch(() => {
              // Invite failed in production code path — the proximity
              // store surfaces the error, we don't double-report.
            });
          }
          return;
        }
        transition(
          peerId,
          {
            kind: 'approaching',
            framesSeen: nextFrames,
            requiredFrames: state.requiredFrames,
          },
          `frame ${String(nextFrames)}/${String(state.requiredFrames)}`,
          source,
          distanceM,
          rssiDbm
        );
        return;
      }
      // While confirmed/exchanging/cooldown, additional distance/RSSI
      // signals do not change state — those transitions come from
      // session events via `notifySessionEvent`.
      case 'confirmed':
      case 'exchanging':
      case 'cooldown':
        return;
    }
  }

  return {
    ingestDistanceUpdate(peerId, distanceM) {
      applySignal(peerId, 'uwb', distanceM, undefined);
    },
    ingestRssi(peerId, rssiDbm) {
      applySignal(peerId, 'rssi', undefined, rssiDbm);
    },
    notifySessionEvent(peerId, kind) {
      const ps = peers.get(peerId);
      if (!ps) return;
      if (kind === 'established' && ps.state.kind === 'confirmed') {
        transition(peerId, { kind: 'exchanging' }, 'session established', null, undefined, undefined);
      } else if (kind === 'dataReceived' && ps.state.kind === 'exchanging') {
        transition(peerId, { kind: 'cooldown' }, 'data received', null, undefined, undefined);
        fireHaptic('success');
        ps.cooldownTimer = setTimeout(() => {
          const cur = peers.get(peerId);
          if (cur && cur.state.kind === 'cooldown') {
            transition(peerId, { kind: 'idle' }, 'cooldown elapsed', null, undefined, undefined);
          }
        }, cooldownMs);
      } else if (kind === 'ended') {
        transition(peerId, { kind: 'idle' }, 'session ended', null, undefined, undefined);
      }
    },
    peerState(peerId) {
      return peers.get(peerId)?.state ?? { kind: 'idle' };
    },
    allPeers() {
      return Array.from(peers.entries()).map(([peerId, ps]) => ({
        peerId,
        state: ps.state,
        source: ps.signalSource,
      }));
    },
    forceIdle(peerId) {
      transition(peerId, { kind: 'idle' }, 'forced idle', null, undefined, undefined);
    },
    forceCooldown(peerId) {
      transition(peerId, { kind: 'cooldown' }, 'forced cooldown', null, undefined, undefined);
      const ps = peers.get(peerId);
      if (ps) {
        ps.cooldownTimer = setTimeout(() => {
          const cur = peers.get(peerId);
          if (cur && cur.state.kind === 'cooldown') {
            transition(peerId, { kind: 'idle' }, 'cooldown elapsed', null, undefined, undefined);
          }
        }, cooldownMs);
      }
    },
    resetSessionMemory() {
      alreadyAutoInvited.clear();
    },
    async simulateProgression(peerId, source, sequence, stepMs = 50) {
      for (const value of sequence) {
        if (source === 'uwb') applySignal(peerId, 'uwb', value, undefined);
        else applySignal(peerId, 'rssi', undefined, value);
        if (stepMs > 0) await new Promise((resolve) => setTimeout(resolve, stepMs));
      }
    },
  };
}
