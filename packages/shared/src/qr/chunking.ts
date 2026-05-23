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
 */
import { base64UrlDecode, base64UrlEncode } from '../crypto/base64';
import { bytesToHex } from '../crypto/hex';
import { sha256Bytes } from '../crypto/hash';
import { utf8ToBytes, bytesToUtf8 } from '../crypto/base64';

export const QR_PREFIX = 'sqc1';
export const QR_MIN_CHUNK_BYTES = 512;
export const QR_DEFAULT_CHUNK_BYTES = 2100;
export const QR_MAX_FRAME_BYTES = 2950;
export const QR_MAX_REASSEMBLED_BYTES = 256 * 1024;
export const QR_MAX_CHUNK_COUNT = 512;

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

export type QrChunkIngestResult =
  | { readonly kind: 'progress'; readonly progress: QrChunkProgress }
  | {
      readonly kind: 'complete';
      readonly payload: string;
      readonly progress: QrChunkProgress;
    };

interface QrChunkFrame {
  readonly sessionId: string;
  readonly index: number;
  readonly totalCount: number;
  readonly digest: string;
  readonly chunk: Uint8Array;
}

export function isChunkFrame(value: string): boolean {
  return value.startsWith(`${QR_PREFIX}.`);
}

/** Strip dashes from a v4 UUID per the Swift impl. */
function newSessionId(): string {
  return crypto.randomUUID().replaceAll('-', '');
}

function frameByteLength(frame: string): number {
  return utf8ToBytes(frame).length;
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

  reset(): void {
    this.sessionId = null;
    this.totalCount = null;
    this.digest = null;
    this.chunks.clear();
  }

  ingest(value: string): QrChunkIngestResult {
    const frame = parseFrame(value);

    if (this.sessionId !== null && this.sessionId !== frame.sessionId) {
      this.reset();
    }
    if (this.sessionId === null) {
      this.sessionId = frame.sessionId;
      this.totalCount = frame.totalCount;
      this.digest = frame.digest;
    }
    if (this.totalCount !== frame.totalCount || this.digest !== frame.digest) {
      throw new QrChunkError('invalidFrameMetadata');
    }

    const existing = this.chunks.get(frame.index);
    if (existing) {
      if (bytesToHex(existing) !== bytesToHex(frame.chunk)) {
        throw new QrChunkError('chunkConflict');
      }
    } else {
      this.chunks.set(frame.index, frame.chunk);
    }

    const progress: QrChunkProgress = {
      sessionId: frame.sessionId,
      receivedCount: this.chunks.size,
      totalCount: frame.totalCount,
    };

    if (this.chunks.size !== frame.totalCount) {
      return { kind: 'progress', progress };
    }

    const reassembled = this.tryFinalise(frame.totalCount, frame.digest);
    if (!reassembled) return { kind: 'progress', progress };

    this.reset();
    return { kind: 'complete', payload: reassembled, progress };
  }

  private tryFinalise(total: number, expectedDigest: string): string | null {
    let totalLen = 0;
    for (let i = 0; i < total; i++) {
      const c = this.chunks.get(i);
      if (!c) return null;
      totalLen += c.length;
      if (totalLen > QR_MAX_REASSEMBLED_BYTES) {
        throw new QrChunkError('payloadTooLarge');
      }
    }
    const buf = new Uint8Array(totalLen);
    let pos = 0;
    for (let i = 0; i < total; i++) {
      const c = this.chunks.get(i);
      if (!c) return null;
      buf.set(c, pos);
      pos += c.length;
    }
    if (bytesToHex(sha256Bytes(buf)) !== expectedDigest) {
      throw new QrChunkError('digestMismatch');
    }
    try {
      return bytesToUtf8(buf);
    } catch {
      throw new QrChunkError('malformedFrame');
    }
  }
}
