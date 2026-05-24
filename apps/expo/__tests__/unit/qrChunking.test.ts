/**
 * QR chunking — round-trip + edge-case state-machine coverage.
 *
 * Wire format is Swift-anchored (see packages/parity-fixtures/fixtures/qr).
 * These tests exercise the TS reassembler's recoverable state machine on top
 * of that format. The parity test in
 * apps/expo/__tests__/parity/qrChunking.parity.test.ts pins byte-for-byte
 * compatibility with Swift-produced frames.
 */
import { describe, expect, it } from 'bun:test';

import {
  isChunkFrame,
  makeFrames,
  parseFrame,
  QR_DEFAULT_CHUNK_BYTES,
  QR_DEFAULT_STALE_MS,
  QR_MAX_REASSEMBLED_BYTES,
  QR_PREFIX,
  QrChunkError,
  QrChunkReassembler,
} from '@solidarity/shared';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** Replace the base64url chunk of a frame with `replacement`, preserving
 *  every other field. Used to forge conflicting frames in the same session. */
function withReplacedChunkB64(frame: string, replacement: string): string {
  const parts = frame.split('.');
  parts[5] = replacement;
  return parts.join('.');
}

/** Replace a single field of a frame. */
function withField(frame: string, fieldIndex: number, replacement: string): string {
  const parts = frame.split('.');
  parts[fieldIndex] = replacement;
  return parts.join('.');
}

function multiFramePayload(): string {
  return 'A'.repeat(QR_DEFAULT_CHUNK_BYTES * 3 + 17);
}

/** Pure-TS base64url encoder for test fixtures (avoids node Buffer). */
function toBase64Url(bytes: Uint8Array): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triple >> 18) & 0x3f] ?? '';
    out += alphabet[(triple >> 12) & 0x3f] ?? '';
    if (i + 1 < bytes.length) out += alphabet[(triple >> 6) & 0x3f] ?? '';
    if (i + 2 < bytes.length) out += alphabet[triple & 0x3f] ?? '';
  }
  return out;
}

// ---------------------------------------------------------------------------
// Happy path / existing coverage
// ---------------------------------------------------------------------------

describe('QR chunking — round trip', () => {
  it('round-trips a small payload', () => {
    const payload = 'hello world';
    const frames = makeFrames(payload);
    expect(frames.length).toBe(1);
    expect(isChunkFrame(frames[0] ?? '')).toBe(true);
    const r = new QrChunkReassembler().ingest(frames[0] ?? '');
    expect(r.kind).toBe('complete');
    if (r.kind === 'complete') expect(r.payload).toBe(payload);
  });

  it('round-trips a payload that requires multiple frames', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    expect(frames.length).toBe(4);
    const reassembler = new QrChunkReassembler();
    let done: string | null = null;
    for (const f of frames) {
      const r = reassembler.ingest(f);
      if (r.kind === 'complete') done = r.payload;
    }
    expect(done).toBe(payload);
  });

  it('rejects payload over 256 KiB at encode time', () => {
    const payload = 'x'.repeat(QR_MAX_REASSEMBLED_BYTES + 1);
    expect(() => makeFrames(payload)).toThrow(QrChunkError);
  });

  it('parseFrame rejects bad prefix', () => {
    expect(() => parseFrame('nope.aaa.0.1.aa.bb')).toThrow(QrChunkError);
  });

  it('isChunkFrame correctly classifies', () => {
    expect(isChunkFrame(`${QR_PREFIX}.foo`)).toBe(true);
    expect(isChunkFrame('https://solidarity.gg')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge-case state machine
// ---------------------------------------------------------------------------

describe('QrChunkReassembler — frame loss', () => {
  it('reports missing indices while incomplete', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    expect(frames.length).toBe(4);
    const reassembler = new QrChunkReassembler();

    const r0 = reassembler.ingest(frames[0] ?? '');
    expect(r0.kind).toBe('incomplete');
    if (r0.kind === 'incomplete') {
      expect(r0.missing).toEqual([1, 2, 3]);
      expect(r0.progress.receivedCount).toBe(1);
      expect(r0.progress.totalCount).toBe(4);
    }

    const r1 = reassembler.ingest(frames[1] ?? '');
    expect(r1.kind).toBe('incomplete');
    // Skip frame 2 → ingest frame 3.
    const r3 = reassembler.ingest(frames[3] ?? '');
    expect(r3.kind).toBe('incomplete');
    if (r3.kind === 'incomplete') {
      // Only index 2 still outstanding so UI can prompt for that specific frame.
      expect(r3.missing).toEqual([2]);
      expect(r3.progress.receivedCount).toBe(3);
    }

    // Recovery — show the missing frame and we finally complete.
    const done = reassembler.ingest(frames[2] ?? '');
    expect(done.kind).toBe('complete');
    if (done.kind === 'complete') expect(done.payload).toBe(payload);
  });
});

describe('QrChunkReassembler — out-of-order arrival', () => {
  it('accepts frames in any order and completes', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    const order = [2, 0, 3, 1];
    const reassembler = new QrChunkReassembler();
    let completed: string | null = null;
    for (const idx of order) {
      const r = reassembler.ingest(frames[idx] ?? '');
      if (r.kind === 'complete') completed = r.payload;
    }
    expect(completed).toBe(payload);
  });
});

describe('QrChunkReassembler — duplicate frames', () => {
  it('ignores identical re-scans (idempotent)', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    const reassembler = new QrChunkReassembler();
    // Sequence with duplicates: 0, 1, 1, 2, 2, 3
    const dupSeq = [0, 1, 1, 2, 2, 3];
    let completed: string | null = null;
    for (const idx of dupSeq) {
      const r = reassembler.ingest(frames[idx] ?? '');
      if (r.kind === 'complete') completed = r.payload;
      // Duplicates must keep counts honest — no double-counting.
      else if (r.kind === 'incomplete') {
        expect(r.progress.receivedCount).toBeLessThanOrEqual(4);
      }
    }
    expect(completed).toBe(payload);
  });

  it('completing then re-ingesting the same single-frame payload starts a fresh session', () => {
    const frames = makeFrames('hello');
    const reassembler = new QrChunkReassembler();
    const a = reassembler.ingest(frames[0] ?? '');
    expect(a.kind).toBe('complete');
    const b = reassembler.ingest(frames[0] ?? '');
    expect(b.kind).toBe('complete');
    if (b.kind === 'complete') expect(b.payload).toBe('hello');
  });
});

describe('QrChunkReassembler — conflicting frames', () => {
  it('emits conflict with the offending frameIndex and auto-resets', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    const reassembler = new QrChunkReassembler();
    reassembler.ingest(frames[0] ?? '');
    reassembler.ingest(frames[1] ?? '');

    // Forge a frame with the same session+index 1 but different bytes.
    // Use raw base64url chars (no padding) so parseFrame doesn't reject it.
    const tampered = withReplacedChunkB64(frames[1] ?? '', 'QUFB'); // "AAA"
    const r = reassembler.ingest(tampered);

    expect(r.kind).toBe('conflict');
    if (r.kind === 'conflict') {
      expect(r.frameIndex).toBe(1);
      // sessionId echoed so UI can correlate with whichever burst was active.
      expect(r.sessionId).toBe(parseFrame(frames[0] ?? '').sessionId);
    }

    // After a conflict the reassembler must be empty: starting a fresh
    // session works immediately.
    const fresh = makeFrames('next burst');
    const after = reassembler.ingest(fresh[0] ?? '');
    expect(after.kind).toBe('complete');
  });
});

describe('QrChunkReassembler — CRC mismatch', () => {
  it('emits corrupt and resets when reassembled bytes fail SHA-256', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    expect(frames.length).toBe(4);

    // Bypass the conflict-detection path by injecting different chunk data
    // BEFORE any genuine frame for that index lands. We do that by ingesting
    // a tampered frame for index 0 first — the reassembler can't know it's
    // wrong until all chunks are in and the final CRC check runs.
    //
    // We replace frame 0's chunk with the same-length placeholder bytes so
    // chunk concatenation lines up but the SHA differs.
    const original0 = parseFrame(frames[0] ?? '');
    const replacementChunk = new Uint8Array(original0.chunk.length).fill(0x42); // 'B'
    const tampered0 = withReplacedChunkB64(frames[0] ?? '', toBase64Url(replacementChunk));

    const reassembler = new QrChunkReassembler();
    // Ingest tampered frame 0, then frames 1..3 unchanged. The reassembler
    // can't tell anything's wrong until all four chunks are in and the
    // final SHA-256 over the concatenation fails.
    expect(reassembler.ingest(tampered0).kind).toBe('incomplete');
    expect(reassembler.ingest(frames[1] ?? '').kind).toBe('incomplete');
    expect(reassembler.ingest(frames[2] ?? '').kind).toBe('incomplete');
    const r = reassembler.ingest(frames[3] ?? '');
    expect(r.kind).toBe('corrupt');
    if (r.kind === 'corrupt') {
      expect(r.totalCount).toBe(4);
      expect(r.sessionId.length).toBe(32);
    }

    // Reassembler is empty after a corrupt event — a fresh session works.
    const next = makeFrames('after corrupt');
    expect(reassembler.ingest(next[0] ?? '').kind).toBe('complete');
  });
});

describe('QrChunkReassembler — oversize payload guard', () => {
  it('throws payloadTooLarge when accumulated frames would exceed MAX', () => {
    // Build a 2-frame session where each chunk is 200 000 B (total 400 000
    // > QR_MAX_REASSEMBLED_BYTES = 256 KiB). The reassembler must refuse
    // before completing reassembly so memory stays bounded for adversarial
    // input. We forge the frames directly because makeFrames would reject
    // the source payload upfront.
    const seed = makeFrames('seed');
    const session = (seed[0] ?? '').split('.')[1] ?? '';
    const digest = (seed[0] ?? '').split('.')[4] ?? '';
    const huge = new Uint8Array(200_000).fill(0x41);
    const hugeB64 = toBase64Url(huge);
    const f0 = [QR_PREFIX, session, '0', '2', digest, hugeB64].join('.');
    const f1 = [QR_PREFIX, session, '1', '2', digest, hugeB64].join('.');
    expect(() => {
      const r = new QrChunkReassembler();
      r.ingest(f0);
      r.ingest(f1);
    }).toThrow(QrChunkError);
  });

  it('rejects encoding a payload over MAX upfront via makeFrames', () => {
    const payload = 'x'.repeat(QR_MAX_REASSEMBLED_BYTES + 1);
    expect(() => makeFrames(payload)).toThrow(QrChunkError);
  });
});

describe('QrChunkReassembler — frame version mismatch', () => {
  it('emits unsupportedVersion for a future sqcN prefix', () => {
    const frames = makeFrames('hello');
    const f = frames[0] ?? '';
    const future = withField(f, 0, 'sqc2'); // simulated v2 prefix
    const r = new QrChunkReassembler().ingest(future);
    expect(r.kind).toBe('unsupportedVersion');
    if (r.kind === 'unsupportedVersion') {
      expect(r.receivedPrefix).toBe('sqc2');
    }
  });

  it('falls back to throwing malformedFrame for unrelated prefixes', () => {
    expect(() => new QrChunkReassembler().ingest('zzz.x.x.x.x.x')).toThrow(QrChunkError);
  });
});

describe('QrChunkReassembler — session collision via total mismatch', () => {
  it('treats a frame with same session but different totalCount as a new session', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    const reassembler = new QrChunkReassembler();
    reassembler.ingest(frames[0] ?? '');

    // Forge a frame in the *same* session id (no sessionChange branch) but
    // with totalCount=2 instead of 4 — clearly a different burst.
    // We also have to fix `index` to be valid for the new total.
    const tamperedTotal = withField(frames[0] ?? '', 3, '2');
    const r = reassembler.ingest(tamperedTotal);
    expect(r.kind).toBe('staleReset');
    if (r.kind === 'staleReset') {
      expect(r.reason).toBe('totalMismatch');
      // The same call automatically re-ingests the new frame as frame-0 of a
      // fresh session, so the inner result is `incomplete` with the new total.
      expect(r.next.kind).toBe('incomplete');
      if (r.next.kind === 'incomplete') {
        expect(r.next.progress.totalCount).toBe(2);
        expect(r.next.progress.receivedCount).toBe(1);
      }
    }
  });

  it('handles a different sessionId as a sessionChange reset', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    const reassembler = new QrChunkReassembler();
    reassembler.ingest(frames[0] ?? '');

    // Build a frame from a *different* session for the same payload.
    const other = makeFrames(payload);
    const otherFirst = other[0] ?? '';
    // Sanity: the sessionId actually differs.
    expect(parseFrame(otherFirst).sessionId).not.toBe(parseFrame(frames[0] ?? '').sessionId);

    const r = reassembler.ingest(otherFirst);
    expect(r.kind).toBe('staleReset');
    if (r.kind === 'staleReset') {
      expect(r.reason).toBe('sessionChange');
      expect(r.next.kind).toBe('incomplete');
    }
  });
});

describe('QrChunkReassembler — staleness', () => {
  it('exposes staleSince and isStale based on injected clock', () => {
    let clock = 1_000;
    const reassembler = new QrChunkReassembler({ now: () => clock, maxStaleMs: 5_000 });
    expect(reassembler.staleSince).toBeNull();
    expect(reassembler.isStale()).toBe(false);

    const frames = makeFrames(multiFramePayload());
    reassembler.ingest(frames[0] ?? '');
    expect(reassembler.staleSince).toBe(1_000);
    expect(reassembler.isStale()).toBe(false);

    clock = 4_000;
    expect(reassembler.isStale()).toBe(false);
    clock = 6_001;
    expect(reassembler.isStale()).toBe(true);
  });

  it('drops the accumulator and emits staleReset when a frame arrives after the deadline', () => {
    let clock = 0;
    const reassembler = new QrChunkReassembler({ now: () => clock, maxStaleMs: 1_000 });
    const payload = multiFramePayload();
    const frames = makeFrames(payload);

    clock = 0;
    reassembler.ingest(frames[0] ?? '');
    reassembler.ingest(frames[1] ?? '');

    // Big gap before the next frame.
    clock = 10_000;
    const r = reassembler.ingest(frames[2] ?? '');
    expect(r.kind).toBe('staleReset');
    if (r.kind === 'staleReset') {
      expect(r.reason).toBe('stale');
      expect(r.next.kind).toBe('incomplete');
      if (r.next.kind === 'incomplete') {
        // Old frames 0/1 were dropped, only frame 2 is in the new accumulator.
        expect(r.next.progress.receivedCount).toBe(1);
        // Outstanding indices for the fresh session.
        expect(r.next.missing).toEqual([0, 1, 3]);
      }
    }
  });

  it('default stale window is QR_DEFAULT_STALE_MS', () => {
    let clock = 0;
    const reassembler = new QrChunkReassembler({ now: () => clock });
    reassembler.ingest((makeFrames('x')[0] ?? ''));
    // The previous ingest completed (single-frame payload) so accumulator
    // was reset; staleSince should be null again.
    expect(reassembler.staleSince).toBeNull();

    // Now feed a multi-frame burst and verify the default window.
    const frames = makeFrames(multiFramePayload());
    reassembler.ingest(frames[0] ?? '');
    clock = QR_DEFAULT_STALE_MS - 1;
    expect(reassembler.isStale()).toBe(false);
    clock = QR_DEFAULT_STALE_MS + 1;
    expect(reassembler.isStale()).toBe(true);
  });
});

describe('QrChunkReassembler — backwards-compat invariants', () => {
  it('parity-style sequential ingest still yields complete', () => {
    const payload = multiFramePayload();
    const frames = makeFrames(payload);
    const reassembler = new QrChunkReassembler();
    let completed: string | null = null;
    for (const f of frames) {
      const r = reassembler.ingest(f);
      if (r.kind === 'complete') completed = r.payload;
    }
    expect(completed).toBe(payload);
  });

  it('manual reset clears state and staleSince', () => {
    const reassembler = new QrChunkReassembler();
    const frames = makeFrames(multiFramePayload());
    reassembler.ingest(frames[0] ?? '');
    expect(reassembler.staleSince).not.toBeNull();
    reassembler.reset();
    expect(reassembler.staleSince).toBeNull();
  });
});
