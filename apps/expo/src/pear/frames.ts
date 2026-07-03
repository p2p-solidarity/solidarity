/**
 * Length-prefixed JSON frame codec — the wire format shared by every Pear
 * lane byte pipe: RN <-> worklet IPC (`lane.ts`) and, once relayed, the
 * Noise socket between two peers (`pear/worklet/index.js`, which hand-rolls
 * the identical framing in plain JS since Bare can't `require` this TS
 * module — keep both in sync on any wire-format change).
 *
 * Wire format: 4-byte big-endian unsigned length header, followed by that
 * many UTF-8 bytes of `JSON.stringify(frame)`. No trailer, no checksum —
 * this is a trusted-transport framing concern (splitting/reassembling a
 * byte stream into discrete JSON messages), not an integrity or auth
 * mechanism; that's the caller's job (challenge/response lands in A3.3+).
 *
 * `FrameDecoder` never throws: fragmented input (a frame's bytes arriving
 * across several `push()` calls) is buffered until complete; coalesced
 * input (several frames in one `push()`) all decode in that call; a frame
 * whose declared length exceeds `FRAME_MAX_BYTES` is never buffered at
 * full size — we skip exactly that many bytes as they arrive and emit one
 * `oversized_frame` error, so a malicious/broken peer can't force
 * unbounded memory growth. A frame within the size cap that fails to
 * parse as JSON (or doesn't decode to a plain object) emits an error
 * event instead of throwing, and decoding resumes at the next frame.
 */
import { bytesToUtf8, utf8ToBytes, err, ok, type Result } from '@solidarity/shared';

/** Header is a 4-byte big-endian unsigned frame length. */
export const FRAME_HEADER_BYTES = 4;

/** Hard cap on a single frame's JSON payload, in UTF-8 bytes. */
export const FRAME_MAX_BYTES = 64 * 1024;

export type FrameCodecErrorCode = 'oversized_frame' | 'malformed_json' | 'invalid_frame_shape';

export interface FrameCodecError {
  readonly code: FrameCodecErrorCode;
  readonly message: string;
}

export type FrameEvent =
  | { readonly kind: 'frame'; readonly value: Record<string, unknown> }
  | { readonly kind: 'error'; readonly error: FrameCodecError };

function writeUint32BE(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  const b0 = bytes[offset] ?? 0;
  const b1 = bytes[offset + 1] ?? 0;
  const b2 = bytes[offset + 2] ?? 0;
  const b3 = bytes[offset + 3] ?? 0;
  return (((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Encode one frame for the wire. Fails closed on an oversized payload
 *  instead of silently truncating or throwing. */
export function encodeFrame(frame: Record<string, unknown>): Result<Uint8Array, FrameCodecError> {
  let json: string;
  try {
    json = JSON.stringify(frame);
  } catch (error) {
    return err({
      code: 'malformed_json',
      message: error instanceof Error ? error.message : 'frame is not JSON-serializable',
    });
  }
  if (typeof json !== 'string') {
    // JSON.stringify returns `undefined` for values like a bare function —
    // TS's `Record<string, unknown>` doesn't rule that out at the type level.
    return err({ code: 'malformed_json', message: 'frame serialized to undefined' });
  }

  const payload = utf8ToBytes(json);
  if (payload.length > FRAME_MAX_BYTES) {
    return err({
      code: 'oversized_frame',
      message: `frame of ${payload.length} bytes exceeds the ${FRAME_MAX_BYTES}-byte cap`,
    });
  }

  const out = new Uint8Array(FRAME_HEADER_BYTES + payload.length);
  out.set(writeUint32BE(payload.length), 0);
  out.set(payload, FRAME_HEADER_BYTES);
  return ok(out);
}

function decodePayload(payload: Uint8Array): FrameEvent {
  let text: string;
  try {
    text = bytesToUtf8(payload);
  } catch (error) {
    return {
      kind: 'error',
      error: { code: 'malformed_json', message: error instanceof Error ? error.message : 'invalid UTF-8' },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      kind: 'error',
      error: { code: 'malformed_json', message: error instanceof Error ? error.message : 'invalid JSON' },
    };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'error', error: { code: 'invalid_frame_shape', message: 'frame must decode to a JSON object' } };
  }

  return { kind: 'frame', value: parsed as Record<string, unknown> };
}

/**
 * Stateful decoder for one byte stream (one IPC duplex, one Noise socket).
 * Feed it raw chunks as they arrive; it returns however many complete
 * frame events that chunk completed (zero, one, or several).
 */
export class FrameDecoder {
  private buf: Uint8Array = new Uint8Array(0);
  private skipRemaining = 0;

  push(chunk: Uint8Array): FrameEvent[] {
    this.buf = concatBytes(this.buf, chunk);
    const events: FrameEvent[] = [];

    for (;;) {
      if (this.skipRemaining > 0) {
        const take = Math.min(this.skipRemaining, this.buf.length);
        this.buf = this.buf.subarray(take);
        this.skipRemaining -= take;
        if (this.skipRemaining > 0) break; // still waiting for the rest of the skipped frame
        continue;
      }

      if (this.buf.length < FRAME_HEADER_BYTES) break;

      const len = readUint32BE(this.buf, 0);

      if (len > FRAME_MAX_BYTES) {
        events.push({
          kind: 'error',
          error: {
            code: 'oversized_frame',
            message: `frame of ${len} bytes exceeds the ${FRAME_MAX_BYTES}-byte cap`,
          },
        });
        this.buf = this.buf.subarray(FRAME_HEADER_BYTES);
        this.skipRemaining = len;
        continue;
      }

      if (this.buf.length < FRAME_HEADER_BYTES + len) break; // wait for the rest of this frame

      const payload = this.buf.subarray(FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + len);
      this.buf = this.buf.subarray(FRAME_HEADER_BYTES + len);
      events.push(decodePayload(payload));
    }

    return events;
  }

  /** Drops any buffered partial frame. Recovery hook for callers that want
   *  to resync after treating an error as fatal (unused by `lane.ts` today,
   *  which just keeps decoding — kept for future/test use). */
  reset(): void {
    this.buf = new Uint8Array(0);
    this.skipRemaining = 0;
  }
}
