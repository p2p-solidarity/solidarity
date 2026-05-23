/**
 * QR chunking — round-trip + error-path coverage.
 */
import { describe, expect, it } from 'bun:test';

import {
  isChunkFrame,
  makeFrames,
  parseFrame,
  QrChunkError,
  QrChunkReassembler,
  QR_DEFAULT_CHUNK_BYTES,
  QR_MAX_REASSEMBLED_BYTES,
  QR_PREFIX,
} from '@solidarity/shared';

describe('QR chunking', () => {
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
    const payload = 'A'.repeat(QR_DEFAULT_CHUNK_BYTES * 3 + 17);
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

  it('rejects payload over 256 KiB', () => {
    const payload = 'x'.repeat(QR_MAX_REASSEMBLED_BYTES + 1);
    expect(() => makeFrames(payload)).toThrow(QrChunkError);
  });

  it('parseFrame rejects bad prefix', () => {
    expect(() => parseFrame('nope.aaa.0.1.aa.bb')).toThrow(QrChunkError);
  });

  it('reassembler ignores duplicate identical chunks', () => {
    const frames = makeFrames('hello');
    const reassembler = new QrChunkReassembler();
    const a = reassembler.ingest(frames[0] ?? '');
    expect(a.kind).toBe('complete');
    // Re-ingesting the same frame starts a fresh session (since reset on complete).
    const b = reassembler.ingest(frames[0] ?? '');
    expect(b.kind).toBe('complete');
  });

  it('reassembler throws on conflicting chunk for same (session, index)', () => {
    const frames = makeFrames('A'.repeat(QR_DEFAULT_CHUNK_BYTES + 1));
    const reassembler = new QrChunkReassembler();
    reassembler.ingest(frames[0] ?? '');
    // Forge a frame with the same session+index but different chunk data:
    const tampered = (frames[0] ?? '').split('.').slice(0, 5).join('.') + '.AA';
    expect(() => reassembler.ingest(tampered)).toThrow(QrChunkError);
  });

  it('isChunkFrame correctly classifies', () => {
    expect(isChunkFrame(`${QR_PREFIX}.foo`)).toBe(true);
    expect(isChunkFrame('https://solidarity.gg')).toBe(false);
  });
});
