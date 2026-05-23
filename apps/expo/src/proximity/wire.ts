/**
 * Proximity wire protocol — shared TS encoder/decoder for the L2CAP
 * data path. Both the iOS (CoreBluetooth) and Android (BluetoothSocket
 * via listenUsingInsecureL2capChannel) native impls speak this exact
 * framing, so application-layer code that drives the Nitro module can
 * pre-frame messages here and trust the bytes arrive intact on the
 * peer side.
 *
 * Framing: each application message is shipped as
 *   [ 2-byte big-endian length ] [ payload bytes ]
 *
 * BLE service / characteristic UUIDs and the PSM encoding (2-byte
 * little-endian unsigned 16) are also pinned here so a regression in
 * the native code is caught by tests rather than at runtime in the
 * simulator.
 */
export const PROXIMITY_SERVICE_UUID =
  '4D2C3A01-7A8D-4F2C-9A2E-B5D2C3A17A8D';
export const PROXIMITY_PSM_CHAR_UUID =
  '4D2C3A02-7A8D-4F2C-9A2E-B5D2C3A17A8D';
export const PROXIMITY_INFO_CHAR_UUID =
  '4D2C3A03-7A8D-4F2C-9A2E-B5D2C3A17A8D';

/**
 * Maximum payload size per L2CAP frame. Apple's CBL2CAPChannel uses LE
 * Credit-Based Flow Control with a 1023-byte MTU on practical hardware;
 * Android's L2CAP CoC negotiates similar. We pick 0xFFFF as the
 * length-field cap (uint16) — actual transport may chunk smaller and
 * the reader will reassemble correctly because the length prefix is the
 * authoritative frame boundary, not the underlying MTU.
 */
export const MAX_FRAME_PAYLOAD_BYTES = 0xffff;

/**
 * Encode `payload` as `[uint16-be length][payload]`. Throws if the
 * payload exceeds 65535 bytes — callers must split large messages
 * themselves (the proximity transport is meant for credentials +
 * shoutouts, not file blobs; vault items go through a different path).
 */
export function frameMessage(payload: Uint8Array): Uint8Array {
  if (payload.length > MAX_FRAME_PAYLOAD_BYTES) {
    throw new RangeError(
      `Frame exceeds max L2CAP payload (${String(payload.length)} > ${String(MAX_FRAME_PAYLOAD_BYTES)})`
    );
  }
  const out = new Uint8Array(2 + payload.length);
  out[0] = (payload.length >>> 8) & 0xff;
  out[1] = payload.length & 0xff;
  out.set(payload, 2);
  return out;
}

/**
 * Pull as many complete frames out of `buffer` as possible. Returns the
 * extracted payloads in order and the unread remainder.
 *
 * The reassembly contract assumes both sides agree on framing — a
 * length prefix declaring more bytes than the remaining buffer
 * indicates a partial inbound flush, which the caller should retain
 * until more bytes arrive.
 */
export function drainFrames(
  buffer: Uint8Array
): { readonly frames: readonly Uint8Array[]; readonly rest: Uint8Array } {
  const frames: Uint8Array[] = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const len = (buffer[offset] << 8) | buffer[offset + 1];
    if (offset + 2 + len > buffer.length) break;
    frames.push(buffer.slice(offset + 2, offset + 2 + len));
    offset += 2 + len;
  }
  return { frames, rest: offset === 0 ? buffer : buffer.slice(offset) };
}

/**
 * Encode a CoreBluetooth `CBL2CAPPSM` (uint16) into the 2-byte little-
 * endian representation iOS publishes via its PSM characteristic.
 * Android's BluetoothServerSocket.psm is also int and we encode the
 * same way so cross-platform reads work.
 */
export function encodePsm(psm: number): Uint8Array {
  if (!Number.isInteger(psm) || psm < 0 || psm > 0xffff) {
    throw new RangeError(`PSM out of range: ${String(psm)}`);
  }
  const out = new Uint8Array(2);
  out[0] = psm & 0xff;
  out[1] = (psm >>> 8) & 0xff;
  return out;
}

export function decodePsm(bytes: Uint8Array): number {
  if (bytes.length < 2) {
    throw new RangeError(`PSM byte array too short: ${String(bytes.length)}`);
  }
  return bytes[0] | (bytes[1] << 8);
}

/**
 * Direction vector helper. Native callbacks ship `ProximityDirection`
 * with x/y/z components; the unit check + magnitude helpers make it
 * trivial to bail out on garbage payloads (e.g. all zeros from a peer
 * still warming up). Magnitudes within `±0.05` of `1.0` are treated
 * as valid unit vectors per Apple's NearbyInteraction guidance.
 */
export interface DirectionVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function vectorMagnitude(v: DirectionVector): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function isUnitVector(v: DirectionVector, tolerance = 0.05): boolean {
  return Math.abs(vectorMagnitude(v) - 1) <= tolerance;
}
