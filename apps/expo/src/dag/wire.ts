/**
 * DAG wire layer — frameKind multiplex on top of `src/proximity/wire.ts`
 * so the existing BLE L2CAP transport carries HEADS / WANT / NODE / SDP
 * / ICE messages alongside the established card-exchange traffic.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §5.1.
 *
 * Layout (after proximity/wire strips the outer length prefix):
 *   [uint8 frameKind] [frameKind-specific body]
 *
 * frameKind 0x10–0x7F reserved for sandbox DAG traffic. 0x80–0xFF stays
 * with the existing card-exchange path — sandbox decoders deliberately
 * reject unknown kinds so a regression in either protocol is caught at
 * the wire boundary rather than at the application layer.
 */
import { drainFrames as proxDrainFrames, frameMessage as proxFrameMessage } from '@/proximity/wire';

export const FRAME_KIND_HEADS = 0x10;
export const FRAME_KIND_WANT = 0x11;
export const FRAME_KIND_NODE = 0x12;
export const FRAME_KIND_WEBRTC_SDP = 0x13;
export const FRAME_KIND_WEBRTC_ICE = 0x14;

export type DagFrameKind =
  | typeof FRAME_KIND_HEADS
  | typeof FRAME_KIND_WANT
  | typeof FRAME_KIND_NODE
  | typeof FRAME_KIND_WEBRTC_SDP
  | typeof FRAME_KIND_WEBRTC_ICE;

const ALL_DAG_KINDS = new Set<number>([
  FRAME_KIND_HEADS,
  FRAME_KIND_WANT,
  FRAME_KIND_NODE,
  FRAME_KIND_WEBRTC_SDP,
  FRAME_KIND_WEBRTC_ICE,
]);

export interface DagFrame {
  readonly kind: DagFrameKind;
  readonly body: Uint8Array;
}

/** Encode a typed DAG frame as L2CAP wire bytes (length prefix + kind + body). */
export function encodeDagFrame(frame: DagFrame): Uint8Array {
  const payload = new Uint8Array(1 + frame.body.length);
  payload[0] = frame.kind;
  payload.set(frame.body, 1);
  return proxFrameMessage(payload);
}

/**
 * Decode the inner payload (after proximity/wire's length prefix). Throws on
 * an unknown DAG frameKind — callers should peek `payload[0]` and route
 * non-DAG kinds to the existing card-exchange path before calling.
 */
export function decodeDagFrame(payload: Uint8Array): DagFrame {
  if (payload.length < 1) throw new RangeError('DAG frame too short — missing frameKind byte');
  const kind = payload[0];
  if (kind === undefined || !ALL_DAG_KINDS.has(kind)) {
    throw new RangeError(`Unknown DAG frameKind: 0x${(kind ?? 0).toString(16).padStart(2, '0')}`);
  }
  return { kind: kind as DagFrameKind, body: payload.slice(1) };
}

/** True for any byte the DAG layer claims (0x10–0x7F window currently). */
export function isDagFrameKind(byte: number): boolean {
  return ALL_DAG_KINDS.has(byte);
}

/**
 * Drain the receive buffer of complete proximity frames AND split them into
 * DAG frames + raw card-exchange payloads. Caller routes each list to the
 * appropriate consumer.
 */
export function drainDagFrames(buffer: Uint8Array): {
  readonly dag: readonly DagFrame[];
  readonly otherPayloads: readonly Uint8Array[];
  readonly rest: Uint8Array;
} {
  const { frames, rest } = proxDrainFrames(buffer);
  const dag: DagFrame[] = [];
  const other: Uint8Array[] = [];
  for (const payload of frames) {
    if (payload.length > 0 && isDagFrameKind(payload[0] ?? -1)) {
      dag.push(decodeDagFrame(payload));
    } else {
      other.push(payload);
    }
  }
  return { dag, otherPayloads: other, rest };
}

// ── Body codecs for the spec'd payload shapes ────────────────────────────

/** Concatenate 32-byte SHA-256 hashes (hex) into HEADS / WANT body bytes. */
export function encodeHashList(hashesHex: readonly string[]): Uint8Array {
  const out = new Uint8Array(hashesHex.length * 32);
  for (let i = 0; i < hashesHex.length; i++) {
    const h = hashesHex[i] ?? '';
    if (h.length !== 64) {
      throw new RangeError(`hash[${String(i)}] is not 32 bytes hex (len=${String(h.length)})`);
    }
    for (let j = 0; j < 32; j++) {
      const byte = Number.parseInt(h.substring(j * 2, j * 2 + 2), 16);
      if (!Number.isFinite(byte)) {
        throw new RangeError(`hash[${String(i)}] is not valid hex`);
      }
      out[i * 32 + j] = byte;
    }
  }
  return out;
}

export function decodeHashList(body: Uint8Array): readonly string[] {
  if (body.length % 32 !== 0) {
    throw new RangeError(`hash-list body length ${String(body.length)} not a multiple of 32`);
  }
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 32) {
    let hex = '';
    for (let j = 0; j < 32; j++) {
      hex += (body[i + j] ?? 0).toString(16).padStart(2, '0');
    }
    out.push(hex);
  }
  return out;
}

/** UTF-8 encode canonical JSON for a NODE body. */
export function encodeNodeBody(canonicalJson: string): Uint8Array {
  return new TextEncoder().encode(canonicalJson);
}

export function decodeNodeBody(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}

/** UTF-8 encode a SDP / ICE payload (caller stringifies). */
export function encodeStringBody(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function decodeStringBody(body: Uint8Array): string {
  return new TextDecoder().decode(body);
}
