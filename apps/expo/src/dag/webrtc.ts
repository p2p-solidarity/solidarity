/**
 * DAG WebRTC LAN data channel — sandbox-only wrapper around
 * react-native-webrtc that carries the three-step sync protocol once
 * BLE handed off the SDP/ICE.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §5.2 + §13.1.
 *
 * Design constraints:
 *   - `iceServers: []` by default (LAN-direct only, no STUN/TURN).
 *     Caller may pass a STUN URL per §13.1 — the user has consented in
 *     the P2P Lab ICE field.
 *   - Single DataChannel labelled `solidarity-dag-v1`. Subsequent DAG
 *     frames ride this channel as ArrayBuffer (binary).
 *   - Lazy load react-native-webrtc so the test suite doesn't pull RN
 *     transitively (we already saw expo-haptics bring in RN's
 *     flow-typed index.js and break Bun's parser).
 *   - This module is intentionally **isolated from `src/sakura/webrtc.ts`**
 *     so the relay-fallback semantics there cannot leak into the
 *     LAN-direct sandbox path.
 *
 * Two-phone signalling: SDP + ICE travel over the BLE wire as frame
 * kinds 0x13 / 0x14 (see src/dag/wire.ts). The Lab UI exchanges them
 * via the runSyncStep integration once BLE handshake completes.
 *
 * In-process smoke test (P2P Lab "Smoke test WebRTC pair"): two peer
 * connections within the same app exchange SDP/ICE in-memory, open
 * the channel, send one ping, close. Proves the module wires correctly
 * even when no second device is around.
 */

const CHANNEL_LABEL = 'solidarity-dag-v1';

export interface IceCandidateInit {
  readonly sdp: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
}

export interface DagPeerConnectionConfig {
  /** STUN/TURN list, per §13.1. Empty = LAN-direct only. */
  readonly iceServers?: readonly { readonly urls: string }[];
  readonly onLocalIce: (candidate: IceCandidateInit) => void;
  readonly onMessage: (data: Uint8Array | string) => void;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onError?: (err: Error) => void;
}

export interface DagPeerConnection {
  /** Caller (offerer). Returns local SDP to ship over BLE. */
  offer(): Promise<string>;
  /** Callee. Returns local answer SDP after applying remote offer. */
  acceptOffer(remoteSdp: string): Promise<string>;
  /** Offerer applies the answer. */
  acceptAnswer(remoteSdp: string): Promise<void>;
  /** Either side feeds in remote ICE candidates as they arrive. */
  addRemoteIce(candidate: IceCandidateInit): Promise<void>;
  send(data: Uint8Array | string): void;
  close(): void;
  readonly isOpen: boolean;
  readonly state: string;
}

interface RtcModuleLike {
  // Loose shape — react-native-webrtc's type re-exports vary across
  // versions and we only need a handful of constructors.
  RTCPeerConnection: new (config: { iceServers?: readonly unknown[] }) => RtcPeerConnectionLike;
  RTCSessionDescription: new (init: { type: string; sdp: string }) => unknown;
  RTCIceCandidate: new (init: {
    candidate: string;
    sdpMid?: string | undefined;
    sdpMLineIndex?: number | undefined;
  }) => unknown;
}

interface RtcDataChannelLike {
  binaryType: 'arraybuffer' | 'blob';
  onopen: ((this: unknown) => void) | null;
  onclose: ((this: unknown) => void) | null;
  onmessage: ((this: unknown, ev: { data: unknown }) => void) | null;
  onerror: ((this: unknown, ev: unknown) => void) | null;
  send(data: ArrayBuffer | Uint8Array | string): void;
  close(): void;
  readyState: string;
}

interface RtcPeerConnectionLike {
  connectionState: string;
  onicecandidate: ((this: unknown, ev: { candidate: unknown }) => void) | null;
  ondatachannel: ((this: unknown, ev: { channel: RtcDataChannelLike }) => void) | null;
  createDataChannel(label: string): RtcDataChannelLike;
  createOffer(options?: unknown): Promise<{ type: string; sdp: string }>;
  createAnswer(options?: unknown): Promise<{ type: string; sdp: string }>;
  setLocalDescription(desc: unknown): Promise<void>;
  setRemoteDescription(desc: unknown): Promise<void>;
  addIceCandidate(candidate: unknown): Promise<void>;
  close(): void;
}

let cachedModule: RtcModuleLike | null = null;
let loadAttempted = false;

async function loadModule(): Promise<RtcModuleLike | null> {
  if (cachedModule) return cachedModule;
  if (loadAttempted) return cachedModule;
  loadAttempted = true;
  try {
    const mod = (await import('react-native-webrtc')) as unknown as RtcModuleLike;
    if (typeof mod.RTCPeerConnection !== 'function') return null;
    cachedModule = mod;
    return mod;
  } catch {
    return null;
  }
}

/** True iff react-native-webrtc is loadable on this build. */
export async function isWebRtcAvailable(): Promise<boolean> {
  return (await loadModule()) !== null;
}

/**
 * Build a single-peer DAG connection. Returns null if react-native-webrtc
 * isn't linked (Expo Go / web preview); caller must handle that.
 */
export async function createDagPeerConnection(
  config: DagPeerConnectionConfig
): Promise<DagPeerConnection | null> {
  const mod = await loadModule();
  if (!mod) return null;

  const pc = new mod.RTCPeerConnection({ iceServers: config.iceServers ?? [] });
  let channel: RtcDataChannelLike | null = null;
  let open = false;

  function wireChannel(ch: RtcDataChannelLike): void {
    channel = ch;
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      open = true;
      try { config.onOpen(); } catch { /* UI guard */ }
    };
    ch.onclose = () => {
      open = false;
      try { config.onClose(); } catch { /* UI guard */ }
    };
    ch.onmessage = (ev) => {
      const data = ev.data;
      if (data instanceof ArrayBuffer) {
        try { config.onMessage(new Uint8Array(data)); } catch { /* UI guard */ }
      } else if (typeof data === 'string') {
        try { config.onMessage(data); } catch { /* UI guard */ }
      }
    };
    ch.onerror = (ev) => {
      const err = ev instanceof Error ? ev : new Error('data channel error');
      try { config.onError?.(err); } catch { /* UI guard */ }
    };
  }

  pc.onicecandidate = (ev) => {
    const cand = ev.candidate as
      | { candidate?: string; sdpMid?: string | null; sdpMLineIndex?: number | null }
      | null
      | undefined;
    if (!cand || typeof cand.candidate !== 'string' || cand.candidate.length === 0) return;
    try {
      config.onLocalIce({
        sdp: cand.candidate,
        sdpMid: cand.sdpMid ?? null,
        sdpMLineIndex: cand.sdpMLineIndex ?? null,
      });
    } catch { /* UI guard */ }
  };

  pc.ondatachannel = (ev) => {
    wireChannel(ev.channel);
  };

  return {
    async offer() {
      wireChannel(pc.createDataChannel(CHANNEL_LABEL));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      return offer.sdp;
    },
    async acceptOffer(remoteSdp) {
      const desc = new mod.RTCSessionDescription({ type: 'offer', sdp: remoteSdp });
      await pc.setRemoteDescription(desc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      return answer.sdp;
    },
    async acceptAnswer(remoteSdp) {
      const desc = new mod.RTCSessionDescription({ type: 'answer', sdp: remoteSdp });
      await pc.setRemoteDescription(desc);
    },
    async addRemoteIce(candidate) {
      const ice = new mod.RTCIceCandidate({
        candidate: candidate.sdp,
        sdpMid: candidate.sdpMid === null ? undefined : candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex === null ? undefined : candidate.sdpMLineIndex,
      });
      await pc.addIceCandidate(ice);
    },
    send(data) {
      if (!channel || !open) return;
      try {
        channel.send(data);
      } catch {
        // Channel closed mid-send — surface via onClose path.
      }
    },
    close() {
      try { channel?.close(); } catch { /* already closed */ }
      try { pc.close(); } catch { /* already closed */ }
      open = false;
    },
    get isOpen(): boolean { return open; },
    get state(): string { return pc.connectionState ?? 'unknown'; },
  };
}

/**
 * Smoke-test the WebRTC layer in-process: build two peer connections
 * within the same app, exchange offer/answer + ICE, open the channel,
 * send one ping, close. Returns a result describing what happened.
 *
 * Limitations: ICE may not gather any candidates in some simulator
 * configurations. The smoke test counts as a success if a channel
 * actually opens within the timeout; it counts as a "partial" if the
 * SDP exchange completed but no channel opened (still proves the
 * module wires correctly).
 */
export interface SmokeTestResult {
  readonly status: 'success' | 'partial' | 'unavailable' | 'timeout' | 'error';
  readonly note: string;
  readonly elapsedMs: number;
  readonly receivedPing: boolean;
}

export async function smokeTestPair(timeoutMs = 5000): Promise<SmokeTestResult> {
  const started = performance.now();
  const mod = await loadModule();
  if (!mod) {
    return {
      status: 'unavailable',
      note: 'react-native-webrtc not loadable (Expo Go / web preview / missing native link)',
      elapsedMs: 0,
      receivedPing: false,
    };
  }
  let receivedPing = false;
  let openCount = 0;
  let closed = false;

  function onMsg(data: Uint8Array | string): void {
    if (typeof data === 'string' && data === 'ping') receivedPing = true;
  }

  const a = await createDagPeerConnection({
    iceServers: [],
    onLocalIce: (cand) => { void b?.addRemoteIce(cand).catch(() => undefined); },
    onMessage: () => undefined,
    onOpen: () => { openCount++; },
    onClose: () => undefined,
  });
  const b = await createDagPeerConnection({
    iceServers: [],
    onLocalIce: (cand) => { void a?.addRemoteIce(cand).catch(() => undefined); },
    onMessage: onMsg,
    onOpen: () => { openCount++; },
    onClose: () => undefined,
  });
  if (!a || !b) {
    return {
      status: 'unavailable',
      note: 'createDagPeerConnection returned null on one side',
      elapsedMs: performance.now() - started,
      receivedPing: false,
    };
  }

  try {
    const offerSdp = await a.offer();
    const answerSdp = await b.acceptOffer(offerSdp);
    await a.acceptAnswer(answerSdp);

    const deadline = started + timeoutMs;
    while (!receivedPing && performance.now() < deadline && !closed) {
      if (openCount >= 2 && !receivedPing) {
        try { a.send('ping'); } catch { /* will surface in error path */ }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    closed = true;
    a.close();
    b.close();
    const elapsedMs = performance.now() - started;
    if (receivedPing) {
      return { status: 'success', note: 'channel opened and ping round-tripped', elapsedMs, receivedPing };
    }
    if (openCount >= 1) {
      return { status: 'partial', note: 'SDP exchanged but channel never fully opened on both sides', elapsedMs, receivedPing };
    }
    return { status: 'timeout', note: `no channel open within ${String(timeoutMs)}ms`, elapsedMs, receivedPing };
  } catch (err) {
    closed = true;
    try { a.close(); } catch { /* already closed */ }
    try { b.close(); } catch { /* already closed */ }
    return {
      status: 'error',
      note: err instanceof Error ? err.message : 'unknown WebRTC error',
      elapsedMs: performance.now() - started,
      receivedPing,
    };
  }
}
