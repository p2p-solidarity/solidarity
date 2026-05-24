/**
 * QR code chunking — mirrors solidarity/Services/Card/QRCodeChunkingService.swift.
 *
 * Wire format (per Swift impl, fields dot-separated, base64url chunk last):
 *   sqc1.<sessionId>.<index>.<totalCount>.<sha256_hex>.<base64url_chunk>
 *
 *   sessionId      UUID without dashes (32 hex chars). Stable for the burst.
 *   index          0-based chunk index, < totalCount.
 *   totalCount     int, ≤ MAX_CHUNK_COUNT.
 *   sha256_hex     64-char hex SHA-256 of the FULL reassembled UTF-8 payload.
 *   base64url      RFC 4648 url-safe, no padding.
 *
 * Constraints (Swift parity):
 *   - minChunkDataBytes      512
 *   - defaultChunkDataBytes  2100
 *   - maxFramePayloadBytes   2950   (frame's UTF-8 length budget)
 *   - maxReassembled         256 KiB
 *   - maxChunkCount          512
 *
 * Reassembler state machine (TS-only hardening — does not change wire format):
 *
 *   ingest(frame) returns one of:
 *     - 'complete'           — full payload reassembled, CRC OK, reset performed
 *     - 'incomplete'         — frame accepted; reports `missing` indices for UI
 *     - 'conflict'           — same (session, index) collided with different
 *                              bytes (likely two cards in the same scan).
 *                              Reassembler auto-resets.
 *     - 'corrupt'            — all frames in but SHA-256 over concatenation
 *                              failed. Auto-reset.
 *     - 'unsupportedVersion' — frame prefix is a future `sqcN` we don't grok.
 *                              No state mutation.
 *     - 'staleReset'         — accumulator was cleared because the new frame
 *                              belongs to a different session/total or the
 *                              accumulator was older than `maxStaleMs`. The
 *                              new frame is then ingested as the first of a
 *                              fresh session, so the same call returns the
 *                              follow-up `incomplete` result alongside the
 *                              `reason`.
 *
 *   Throws `QrChunkError` only for upstream wire-format or budget issues that
 *   the consumer cannot recover from by simply continuing to scan
 *   (`malformedFrame`, `invalidFrameMetadata`, `payloadTooLarge`,
 *   `invalidChunkSize`, `frameTooLarge`). Recoverable runtime conditions
 *   surface as ingest result variants so UI can keep the camera rolling.
 */
import { base64UrlDecode, base64UrlEncode } from '../crypto/base64';
import { bytesToHex } from '../crypto/hex';
import { sha256Bytes } from '../crypto/hash';
import { utf8ToBytes, bytesToUtf8 } from '../crypto/base64';
import { uuid } from '../crypto/uuid';

export const QR_PREFIX = 'sqc1';
export const QR_MIN_CHUNK_BYTES = 512;
export const QR_DEFAULT_CHUNK_BYTES = 2100;
export const QR_MAX_FRAME_BYTES = 2950;
export const QR_MAX_REASSEMBLED_BYTES = 256 * 1024;
export const QR_MAX_CHUNK_COUNT = 512;

/** Frames idle for this long are considered stale and the buffer is dropped
 *  before the next ingest. Caller can override via the constructor. */
export const QR_DEFAULT_STALE_MS = 30_000;

export type QrChunkErrorCode =
  | 'invalidChunkSize'
  | 'payloadTooLarge'
  | 'frameTooLarge'
  | 'malformedFrame'
  | 'invalidFrameMetadata'
  | 'chunkConflict'
  | 'digestMismatch';

export class QrChunkError extends Error {
  constructor(public readonly code: QrChunkErrorCode) {
    super(code);
    this.name = 'QrChunkError';
  }
}

export interface QrChunkProgress {
  readonly sessionId: string;
  readonly receivedCount: number;
  readonly totalCount: number;
}

export type QrChunkStaleReason =
  | 'sessionChange'
  | 'totalMismatch'
  | 'digestMismatch'
  | 'stale';

export type QrChunkIngestResult =
  | {
      readonly kind: 'incomplete';
      readonly progress: QrChunkProgress;
      /** Indices still missing in ascending order (so UI can prompt
       *  "show frame N again"). Always non-empty for this variant. */
      readonly missing: readonly number[];
    }
  | {
      readonly kind: 'complete';
      readonly payload: string;
      readonly progress: QrChunkProgress;
    }
  | {
      readonly kind: 'conflict';
      readonly sessionId: string;
      readonly frameIndex: number;
    }
  | {
      readonly kind: 'corrupt';
      readonly sessionId: string;
      readonly totalCount: number;
    }
  | {
      readonly kind: 'unsupportedVersion';
      readonly receivedPrefix: string;
    }
  | {
      readonly kind: 'staleReset';
      readonly reason: QrChunkStaleReason;
      /** Result of ingesting the triggering frame as the first frame of the
       *  fresh session. Always either `incomplete` or `complete` — never
       *  another `staleReset`. */
      readonly next: QrChunkIngestResult;
    };

interface QrChunkFrame {
  readonly sessionId: string;
  readonly index: number;
  readonly totalCount: number;
  readonly digest: string;
  readonly chunk: Uint8Array;
}

interface QrChunkReassemblerOptions {
  /** How long (ms) the accumulator may sit idle before being auto-dropped
   *  on the next ingest. Default `QR_DEFAULT_STALE_MS`. Pass `Infinity`
   *  to disable. */
  readonly maxStaleMs?: number;
  /** Wall-clock provider (test seam). Default `Date.now`. */
  readonly now?: () => number;
}

export function isChunkFrame(value: string): boolean {
  return value.startsWith(`${QR_PREFIX}.`);
}

/** Strip dashes from a v4 UUID per the Swift impl. */
function newSessionId(): string {
  return uuid().replaceAll('-', '');
}

function frameByteLength(frame: string): number {
  return utf8ToBytes(frame).length;
}

/** True for prefixes like `sqc2`, `sqc10`, etc. — versioned but unknown. */
function isFutureVersionPrefix(prefix: string): boolean {
  if (!prefix.startsWith('sqc')) return false;
  if (prefix === QR_PREFIX) return false;
  const tail = prefix.slice(3);
  if (tail.length === 0) return false;
  for (let i = 0; i < tail.length; i++) {
    const c = tail.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return true;
}

/** Encode a UTF-8 payload as a sequence of QR frames. */
export function makeFrames(
  payload: string,
  chunkDataBytes: number = QR_DEFAULT_CHUNK_BYTES
): readonly string[] {
  if (chunkDataBytes <= 0) throw new QrChunkError('invalidChunkSize');
  const data = utf8ToBytes(payload);
  if (data.length > QR_MAX_REASSEMBLED_BYTES) {
    throw new QrChunkError('payloadTooLarge');
  }

  const sessionId = newSessionId();
  const digest = bytesToHex(sha256Bytes(data));
  const totalCount = Math.max(1, Math.ceil(data.length / chunkDataBytes));
  if (totalCount > QR_MAX_CHUNK_COUNT) throw new QrChunkError('payloadTooLarge');

  const frames: string[] = [];
  for (let i = 0; i < totalCount; i++) {
    const start = i * chunkDataBytes;
    const end = Math.min(start + chunkDataBytes, data.length);
    const chunk = data.subarray(start, end);
    const frame = [
      QR_PREFIX,
      sessionId,
      String(i),
      String(totalCount),
      digest,
      base64UrlEncode(chunk),
    ].join('.');
    if (frameByteLength(frame) > QR_MAX_FRAME_BYTES) {
      throw new QrChunkError('frameTooLarge');
    }
    frames.push(frame);
  }
  return frames;
}

/**
 * Result of a lenient prefix/version probe so the reassembler can return a
 * structured `unsupportedVersion` variant without throwing.
 */
function probeVersion(value: string): { ok: true } | { ok: false; receivedPrefix: string } {
  const dotIndex = value.indexOf('.');
  const prefix = dotIndex === -1 ? value : value.slice(0, dotIndex);
  if (prefix === QR_PREFIX) return { ok: true };
  if (isFutureVersionPrefix(prefix)) return { ok: false, receivedPrefix: prefix };
  return { ok: true }; // not a known version family — let parseFrame throw
}

export function parseFrame(value: string): QrChunkFrame {
  const parts = value.split('.');
  if (parts.length !== 6 || parts[0] !== QR_PREFIX) {
    throw new QrChunkError('malformedFrame');
  }
  const [, sessionId, indexStr, totalStr, digest, chunkB64] = parts as [
    string, string, string, string, string, string,
  ];
  const index = Number(indexStr);
  const totalCount = Number(totalStr);
  if (
    !sessionId ||
    !Number.isInteger(index) ||
    !Number.isInteger(totalCount) ||
    index < 0 ||
    totalCount <= 0 ||
    index >= totalCount ||
    totalCount > QR_MAX_CHUNK_COUNT ||
    digest.length !== 64
  ) {
    throw new QrChunkError('invalidFrameMetadata');
  }
  let chunk: Uint8Array;
  try {
    chunk = base64UrlDecode(chunkB64);
  } catch {
    throw new QrChunkError('invalidFrameMetadata');
  }
  return { sessionId, index, totalCount, digest, chunk };
}

export class QrChunkReassembler {
  private sessionId: string | null = null;
  private totalCount: number | null = null;
  private digest: string | null = null;
  private chunks = new Map<number, Uint8Array>();
  private lastIngestAt: number | null = null;
  private readonly maxStaleMs: number;
  private readonly now: () => number;

  constructor(options?: QrChunkReassemblerOptions) {
    this.maxStaleMs = options?.maxStaleMs ?? QR_DEFAULT_STALE_MS;
    this.now = options?.now ?? Date.now;
  }

  reset(): void {
    this.sessionId = null;
    this.totalCount = null;
    this.digest = null;
    this.chunks.clear();
    this.lastIngestAt = null;
  }

  /** Wall-clock timestamp of the last accepted frame, or null if idle. */
  get staleSince(): number | null {
    return this.lastIngestAt;
  }

  /** True iff there is buffered state older than `maxStaleMs`. */
  isStale(at: number = this.now()): boolean {
    return (
      this.lastIngestAt !== null &&
      this.maxStaleMs !== Infinity &&
      at - this.lastIngestAt > this.maxStaleMs
    );
  }

  ingest(value: string): QrChunkIngestResult {
    // 1. Future-version probe — surfaces a structured variant instead of throwing.
    const probe = probeVersion(value);
    if (!probe.ok) {
      return { kind: 'unsupportedVersion', receivedPrefix: probe.receivedPrefix };
    }

    // 2. Stale-buffer eviction must happen before parse so we charge the new
    //    frame against an empty slate (it becomes the first frame of a fresh
    //    session).
    const stale = this.lastIngestAt !== null && this.isStale();
    if (stale) {
      this.reset();
      const next = this.ingestFresh(value);
      return { kind: 'staleReset', reason: 'stale', next };
    }

    return this.ingestInternal(value);
  }

  /** Force the next ingest to be treated as the first frame of a new session.
   *  Used by both the public `reset()` path and by recoverable variants
   *  (`conflict`, `corrupt`, `staleReset`). */
  private ingestFresh(value: string): Exclude<QrChunkIngestResult, { kind: 'staleReset' }> {
    const result = this.ingestInternal(value);
    if (result.kind === 'staleReset') {
      // Defensive — should not happen because we just reset and ingestInternal
      // only emits staleReset via the public ingest() wrapper. Collapse to its
      // inner result so the union shape is honoured.
      return result.next as Exclude<QrChunkIngestResult, { kind: 'staleReset' }>;
    }
    return result;
  }

  private ingestInternal(value: string): QrChunkIngestResult {
    // parseFrame throws QrChunkError for unrecoverable wire-format issues;
    // those are surfaced to the caller as today.
    const frame = parseFrame(value);

    // Session collision (same scanner sees a frame from a different burst).
    if (this.sessionId !== null && this.sessionId !== frame.sessionId) {
      this.reset();
      const next = this.ingestFresh(value);
      return { kind: 'staleReset', reason: 'sessionChange', next };
    }

    // First frame of a (potentially new) session.
    if (this.sessionId === null) {
      // Pre-flight oversize check: even when totalCount is in range the
      // first chunk might already reveal that the burst can't fit in
      // QR_MAX_REASSEMBLED_BYTES (chunks * declared total). This is the
      // cheapest forge-resistant lower bound — uses the actual size of the
      // chunk in hand. The cumulative cap in tryFinalise is the hard
      // fail-safe, but rejecting here keeps the accumulator from growing.
      const lowerBoundBytes = frame.chunk.length * frame.totalCount;
      if (lowerBoundBytes > QR_MAX_REASSEMBLED_BYTES) {
        throw new QrChunkError('payloadTooLarge');
      }
      this.sessionId = frame.sessionId;
      this.totalCount = frame.totalCount;
      this.digest = frame.digest;
    }

    // total/digest mismatch within the same sessionId is undefined behaviour
    // on the wire — Swift treats it as an error. We treat it as a
    // session-collision and start over: drop the previous accumulator and
    // restart with this frame as the first of a new burst. The outer caller
    // gets a `staleReset` so it knows the previous progress was discarded.
    if (this.totalCount !== frame.totalCount) {
      this.reset();
      const next = this.ingestFresh(value);
      return { kind: 'staleReset', reason: 'totalMismatch', next };
    }
    if (this.digest !== frame.digest) {
      this.reset();
      const next = this.ingestFresh(value);
      return { kind: 'staleReset', reason: 'digestMismatch', next };
    }

    // Duplicate / conflict detection.
    const existing = this.chunks.get(frame.index);
    if (existing) {
      if (!bytesEqual(existing, frame.chunk)) {
        const sessionId = this.sessionId;
        const frameIndex = frame.index;
        this.reset();
        return { kind: 'conflict', sessionId, frameIndex };
      }
      // Identical duplicate — no-op.
    } else {
      this.chunks.set(frame.index, frame.chunk);
    }

    this.lastIngestAt = this.now();

    const progress: QrChunkProgress = {
      sessionId: frame.sessionId,
      receivedCount: this.chunks.size,
      totalCount: frame.totalCount,
    };

    if (this.chunks.size !== frame.totalCount) {
      return { kind: 'incomplete', progress, missing: this.missingIndices(frame.totalCount) };
    }

    const finalised = this.tryFinalise(frame.totalCount, frame.digest);
    if (finalised.kind === 'corrupt') {
      const sessionId = frame.sessionId;
      const totalCount = frame.totalCount;
      this.reset();
      return { kind: 'corrupt', sessionId, totalCount };
    }
    if (finalised.kind === 'incomplete') {
      return { kind: 'incomplete', progress, missing: this.missingIndices(frame.totalCount) };
    }

    this.reset();
    return { kind: 'complete', payload: finalised.payload, progress };
  }

  private missingIndices(total: number): readonly number[] {
    const out: number[] = [];
    for (let i = 0; i < total; i++) {
      if (!this.chunks.has(i)) out.push(i);
    }
    return out;
  }

  private tryFinalise(
    total: number,
    expectedDigest: string
  ):
    | { kind: 'incomplete' }
    | { kind: 'corrupt' }
    | { kind: 'complete'; payload: string } {
    let totalLen = 0;
    for (let i = 0; i < total; i++) {
      const c = this.chunks.get(i);
      if (!c) return { kind: 'incomplete' };
      totalLen += c.length;
      if (totalLen > QR_MAX_REASSEMBLED_BYTES) {
        throw new QrChunkError('payloadTooLarge');
      }
    }
    const buf = new Uint8Array(totalLen);
    let pos = 0;
    for (let i = 0; i < total; i++) {
      const c = this.chunks.get(i);
      if (!c) return { kind: 'incomplete' };
      buf.set(c, pos);
      pos += c.length;
    }
    if (bytesToHex(sha256Bytes(buf)) !== expectedDigest) {
      return { kind: 'corrupt' };
    }
    try {
      return { kind: 'complete', payload: bytesToUtf8(buf) };
    } catch {
      // Decoded bytes weren't valid UTF-8 — treat as corruption rather than
      // letting an opaque decoder error escape. (CRC matched but somehow the
      // payload still isn't valid UTF-8 — only possible if the sender lied
      // about the original encoding, which we treat as a session-level fault.)
      return { kind: 'corrupt' };
    }
  }
}

/** Constant-time-ish equality is unnecessary here (no secret material). */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
