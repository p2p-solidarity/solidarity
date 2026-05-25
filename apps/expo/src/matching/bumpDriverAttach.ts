/**
 * Bump driver Nitro attachment — sandbox-only glue that subscribes the
 * `BumpDriver` to the same nitro-proximity event stream the public
 * matching session already listens to.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §3.3.1 — "Sandbox-only: the
 * bump driver lives in src/matching/uwbBumpDriver.ts and is **only
 * registered as a listener when developerMode is true**. The existing
 * public Share tab continues to use the manual tap-to-connect flow
 * until the bump graduates (per §11). During sandbox testing the bump
 * runs *in parallel* with the manual flow — both produce a successful
 * exchange — so the public surface is not affected."
 *
 * Implementation: a single module-level subscription handle so multiple
 * Lab mounts can't accidentally attach twice (the matching session has
 * the same protection on its own listener).
 */
import type { BumpDriver } from './uwbBumpDriver';

interface NitroPeerLike {
  readonly id: string;
  readonly rssi?: number;
}

interface NitroEventLike {
  readonly kind: string;
  readonly peer?: NitroPeerLike;
  readonly peerId?: string;
  readonly distance?: number;
}

interface NitroProximityLike {
  invitePeer(
    peerId: string,
    payload: ArrayBuffer,
    timeoutSec: number
  ): Promise<boolean>;
  addEventListener(handler: (event: NitroEventLike) => void): () => void;
}

let activeUnsubscribe: (() => void) | null = null;
let cachedNitro: NitroProximityLike | null = null;
let nitroLoadAttempted = false;

async function loadNitro(): Promise<NitroProximityLike | null> {
  if (cachedNitro) return cachedNitro;
  if (nitroLoadAttempted) return null;
  nitroLoadAttempted = true;
  try {
    const mod = (await import('@solidarity/nitro-proximity')) as {
      getProximity?: () => NitroProximityLike;
    };
    if (typeof mod.getProximity !== 'function') return null;
    cachedNitro = mod.getProximity();
    return cachedNitro;
  } catch {
    return null;
  }
}

/**
 * Subscribe `driver` to the live nitro-proximity stream. Returns true
 * iff the native module was available and a subscription was created
 * (or one was already active — idempotent). Safe to call multiple times.
 */
export async function attachBumpDriverToNitro(driver: BumpDriver): Promise<boolean> {
  if (activeUnsubscribe) return true;
  const nitro = await loadNitro();
  if (!nitro) return false;
  activeUnsubscribe = nitro.addEventListener((event) => {
    if (event.kind === 'distanceUpdate' &&
        typeof event.peerId === 'string' &&
        typeof event.distance === 'number') {
      driver.ingestDistanceUpdate(event.peerId, event.distance);
      return;
    }
    if (event.kind === 'peerFound' &&
        event.peer &&
        typeof event.peer.id === 'string' &&
        typeof event.peer.rssi === 'number') {
      driver.ingestRssi(event.peer.id, event.peer.rssi);
      return;
    }
    if (event.kind === 'sessionEstablished' && typeof event.peerId === 'string') {
      driver.notifySessionEvent(event.peerId, 'established');
      return;
    }
    if (event.kind === 'dataReceived' && typeof event.peerId === 'string') {
      driver.notifySessionEvent(event.peerId, 'dataReceived');
      return;
    }
    if (event.kind === 'sessionEnded' && typeof event.peerId === 'string') {
      driver.notifySessionEvent(event.peerId, 'ended');
      return;
    }
  });
  return true;
}

/** Tear down the subscription. Safe to call when nothing is attached. */
export function detachBumpDriverFromNitro(): void {
  if (!activeUnsubscribe) return;
  try {
    activeUnsubscribe();
  } finally {
    activeUnsubscribe = null;
  }
}

/**
 * Production auto-invite passthrough — the BumpDriver config's
 * `invitePeer` callback delegates here when Live mode is on, so a
 * `confirmed` transition really triggers a BLE invite on a present
 * peer. Falls back to noop when Nitro is unreachable so simulator runs
 * never crash.
 */
export async function invitePeerViaNitro(peerId: string, timeoutSec = 25): Promise<void> {
  const nitro = await loadNitro();
  if (!nitro) return;
  try {
    await nitro.invitePeer(peerId, new ArrayBuffer(0), timeoutSec);
  } catch {
    // The matching store surfaces invite errors via its own listener;
    // we don't duplicate the toast here.
  }
}

/** Test-only: reset the module cache so each suite starts isolated. */
export function _resetBumpDriverAttachForTests(): void {
  detachBumpDriverFromNitro();
  cachedNitro = null;
  nitroLoadAttempted = false;
}
