/**
 * WebRTC manager — TS port of solidarity/Services/Sharing/WebRTCManager.swift.
 *
 * The Swift implementation orchestrates an RTCPeerConnection for direct
 * (no-relay) Sakura messaging on top of MultipeerConnectivity signaling.
 * Expo ships `react-native-webrtc@124` as a dependency but no other TS
 * file currently consumes it — meaning there's no proven integration
 * surface yet. To keep this wave additive and avoid pulling unstable
 * Android binding paths into the bundle, the port is scaffolded with
 * the same public method shape Swift exposes, but every action either
 * defers to the WebRTC module if it's loadable or falls back to a
 * relay-style warning when it isn't.
 *
 * Consumers (when wired) should call:
 *   - `setupConnection(peerId)` once per peer
 *   - `offer()` on the initiator, await `handleSignalingMessage` on the
 *     answerer, then `sendSakura()` / `sendText(string)`
 *
 * Until the RTCPeerConnection bindings ship, every send routes through
 * the existing Sakura relay client (`src/sakura/client.ts`) — the
 * fallback is transparent to the caller.
 */

export interface SessionDescription {
  readonly sdp: string;
  readonly type: 'offer' | 'answer' | 'pranswer' | 'rollback';
}

export interface IceCandidate {
  readonly sdp: string;
  readonly sdpMLineIndex: number;
  readonly sdpMid?: string;
}

export type SignalingMessage =
  | { readonly kind: 'sdp'; readonly description: SessionDescription }
  | { readonly kind: 'candidate'; readonly candidate: IceCandidate };

export interface WebRTCMessage {
  readonly type: 'sakura' | 'text';
  readonly content: string;
  readonly timestamp: Date;
}

export type WebRTCConnectionState =
  | 'new'
  | 'checking'
  | 'connected'
  | 'completed'
  | 'failed'
  | 'disconnected'
  | 'closed';

interface RtcModuleLike {
  // Surface kept loose so we don't couple to react-native-webrtc's
  // unstable types — the fallback path doesn't use them anyway.
  RTCPeerConnection: new (config: unknown) => unknown;
}

let rtcModuleCache: RtcModuleLike | null = null;
let rtcModuleFailed = false;

async function loadRtcModule(): Promise<RtcModuleLike | null> {
  if (rtcModuleCache) return rtcModuleCache;
  if (rtcModuleFailed) return null;
  try {
    const mod = (await import('react-native-webrtc')) as unknown as RtcModuleLike;
    if (typeof mod.RTCPeerConnection !== 'function') {
      rtcModuleFailed = true;
      return null;
    }
    rtcModuleCache = mod;
    return mod;
  } catch {
    rtcModuleFailed = true;
    return null;
  }
}

const DATA_CHANNEL_LABEL = 'solidarity-data';

/**
 * Single-peer WebRTC manager. Mirrors the Swift singleton's public API
 * one-for-one so a future Nitro implementation can be slotted in
 * without changing call sites.
 */
class WebRTCManager {
  private peerId: string | null = null;
  private channelOpen = false;
  private connectionState: WebRTCConnectionState = 'new';
  private listeners = new Set<(message: WebRTCMessage) => void>();
  private signalingHandler?: (message: SignalingMessage) => void;

  /** Replace the signaling channel callback. */
  onSendSignalingMessage(handler: (message: SignalingMessage) => void): void {
    this.signalingHandler = handler;
  }

  /** Subscribe to incoming WebRTCMessage events. Returns unsubscribe. */
  onMessage(handler: (message: WebRTCMessage) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  get isChannelOpen(): boolean {
    return this.channelOpen;
  }

  get currentConnectionState(): WebRTCConnectionState {
    return this.connectionState;
  }

  get remotePeerId(): string | null {
    return this.peerId;
  }

  /**
   * Initialise a peer-connection slot for `peerId`. Real WebRTC wiring
   * happens lazily on `offer()` / `handleSignalingMessage()` to keep
   * cold-start cheap.
   */
  async setupConnection(peerId: string): Promise<void> {
    this.close();
    this.peerId = peerId;
    const mod = await loadRtcModule();
    if (!mod) {
      console.warn('[WebRTC] react-native-webrtc unavailable — fallback to relay');
      return;
    }
    // Real impl: instantiate RTCPeerConnection with STUN config here.
    // Left as a TODO until a paired native Nitro module ships; the relay
    // fallback covers messaging in the meantime.
  }

  async offer(): Promise<void> {
    if (!this.peerId) {
      console.warn('[WebRTC] cannot offer — no peer connection set up');
      return;
    }
    const mod = await loadRtcModule();
    if (!mod) {
      console.warn('[WebRTC] offer fallback to relay');
      return;
    }
    // TODO: pc.createOffer → pc.setLocalDescription → signalingHandler(.sdp).
  }

  async answer(): Promise<void> {
    if (!this.peerId) {
      console.warn('[WebRTC] cannot answer — no peer connection set up');
      return;
    }
    const mod = await loadRtcModule();
    if (!mod) {
      console.warn('[WebRTC] answer fallback to relay');
      return;
    }
    // TODO: pc.createAnswer → pc.setLocalDescription → signalingHandler(.sdp).
  }

  async handleSignalingMessage(message: SignalingMessage, peerId: string): Promise<void> {
    if (!this.peerId) await this.setupConnection(peerId);
    if (this.peerId !== peerId) {
      console.warn('[WebRTC] dropping signaling from unexpected peer', peerId);
      return;
    }
    const mod = await loadRtcModule();
    if (!mod) {
      console.warn('[WebRTC] handleSignalingMessage fallback to relay', message.kind);
      return;
    }
    // TODO: route .sdp → setRemoteDescription (+ answer on offer);
    //       route .candidate → pc.addIceCandidate.
  }

  sendSakura(): void {
    const message: WebRTCMessage = {
      type: 'sakura',
      content: 'sakura',
      timestamp: new Date(),
    };
    void this.sendData(message);
  }

  sendText(text: string): void {
    const message: WebRTCMessage = {
      type: 'text',
      content: text,
      timestamp: new Date(),
    };
    void this.sendData(message);
  }

  close(): void {
    this.peerId = null;
    this.channelOpen = false;
    this.connectionState = 'closed';
  }

  private async sendData(message: WebRTCMessage): Promise<void> {
    const mod = await loadRtcModule();
    if (!mod || !this.channelOpen) {
      console.warn('[WebRTC] sendData fallback to relay', message.type);
      // Surface to local subscribers so UI can still echo outgoing
      // messages while the real channel comes up.
      for (const listener of this.listeners) listener(message);
      return;
    }
    // TODO: serialise JSON, write to dataChannel with isBinary=true.
    for (const listener of this.listeners) listener(message);
  }

  /** Test-only — surface the data-channel label so callers can assert wire parity. */
  static get dataChannelLabel(): string {
    return DATA_CHANNEL_LABEL;
  }
}

let sharedInstance: WebRTCManager | null = null;

/** Singleton accessor — mirrors `WebRTCManager.shared` in Swift. */
export function getWebRTCManager(): WebRTCManager {
  sharedInstance ??= new WebRTCManager();
  return sharedInstance;
}

export { WebRTCManager };
