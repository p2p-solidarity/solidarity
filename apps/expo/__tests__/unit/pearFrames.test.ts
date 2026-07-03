/**
 * `src/pear/frames.ts` — length-prefixed JSON frame codec.
 *
 * Covers the properties the Pear worklet relay depends on: a decoder must
 * survive a stream split at any byte offset (fragmented), several frames
 * arriving in one chunk (coalesced), a peer claiming an oversized frame,
 * and a peer sending bytes that aren't valid JSON — none of these may
 * throw or desync the decoder for frames that follow.
 */
import { describe, expect, it } from 'bun:test';

import {
  encodeFrame,
  FrameDecoder,
  FRAME_HEADER_BYTES,
  FRAME_MAX_BYTES,
  type FrameEvent,
} from '../../src/pear/frames';

function framesOf(events: FrameEvent[]): Record<string, unknown>[] {
  return events.filter((e): e is Extract<FrameEvent, { kind: 'frame' }> => e.kind === 'frame').map((e) => e.value);
}

function errorsOf(events: FrameEvent[]): FrameEvent[] {
  return events.filter((e) => e.kind === 'error');
}

describe('pear/frames — encodeFrame', () => {
  it('round-trips through a fresh FrameDecoder', () => {
    const encoded = encodeFrame({ t: 'hello', n: 1 });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoder = new FrameDecoder();
    const events = decoder.push(encoded.value);
    expect(framesOf(events)).toEqual([{ t: 'hello', n: 1 }]);
  });

  it('rejects a payload over the 64KB cap instead of encoding it', () => {
    const encoded = encodeFrame({ t: 'huge', blob: 'x'.repeat(FRAME_MAX_BYTES) });
    expect(encoded.ok).toBe(false);
    if (encoded.ok) return;
    expect(encoded.error.code).toBe('oversized_frame');
  });

  it('encodes a 4-byte big-endian length header', () => {
    const encoded = encodeFrame({});
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const json = JSON.stringify({});
    const expectedLen = new TextEncoder().encode(json).length;
    const header = encoded.value.slice(0, FRAME_HEADER_BYTES);
    const readBack = ((header[0] ?? 0) << 24) | ((header[1] ?? 0) << 16) | ((header[2] ?? 0) << 8) | (header[3] ?? 0);
    expect(readBack >>> 0).toBe(expectedLen);
  });
});

describe('pear/frames — FrameDecoder', () => {
  it('decodes several frames coalesced into a single chunk', () => {
    const a = encodeFrame({ t: 'a' });
    const b = encodeFrame({ t: 'b' });
    const c = encodeFrame({ t: 'c' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('setup failed');

    const combined = new Uint8Array(a.value.length + b.value.length + c.value.length);
    combined.set(a.value, 0);
    combined.set(b.value, a.value.length);
    combined.set(c.value, a.value.length + b.value.length);

    const decoder = new FrameDecoder();
    const events = decoder.push(combined);
    expect(framesOf(events)).toEqual([{ t: 'a' }, { t: 'b' }, { t: 'c' }]);
  });

  it('decodes a frame split across many small pushes (byte-at-a-time)', () => {
    const encoded = encodeFrame({ t: 'fragmented', data: [1, 2, 3] });
    if (!encoded.ok) throw new Error('setup failed');

    const decoder = new FrameDecoder();
    const collected: FrameEvent[] = [];
    for (const byte of encoded.value) {
      collected.push(...decoder.push(new Uint8Array([byte])));
    }
    expect(framesOf(collected)).toEqual([{ t: 'fragmented', data: [1, 2, 3] }]);
  });

  it('decodes a frame whose header and body arrive in separate chunks', () => {
    const encoded = encodeFrame({ t: 'split-header' });
    if (!encoded.ok) throw new Error('setup failed');

    const decoder = new FrameDecoder();
    // Header split 2/2.
    const e1 = decoder.push(encoded.value.slice(0, 2));
    const e2 = decoder.push(encoded.value.slice(2, FRAME_HEADER_BYTES));
    const e3 = decoder.push(encoded.value.slice(FRAME_HEADER_BYTES));
    expect(framesOf([...e1, ...e2, ...e3])).toEqual([{ t: 'split-header' }]);
  });

  it('resumes decoding correctly after a fragmented frame followed by a full one', () => {
    const first = encodeFrame({ t: 'first' });
    const second = encodeFrame({ t: 'second' });
    if (!first.ok || !second.ok) throw new Error('setup failed');

    const decoder = new FrameDecoder();
    const collected: FrameEvent[] = [];
    // First frame arrives split; second frame arrives whole, appended to
    // the same chunk as the tail of the first.
    collected.push(...decoder.push(first.value.slice(0, 3)));
    const tailPlusSecond = new Uint8Array(first.value.length - 3 + second.value.length);
    tailPlusSecond.set(first.value.slice(3), 0);
    tailPlusSecond.set(second.value, first.value.length - 3);
    collected.push(...decoder.push(tailPlusSecond));

    expect(framesOf(collected)).toEqual([{ t: 'first' }, { t: 'second' }]);
  });

  it('emits an oversized_frame error and skips exactly the declared length, without buffering it', () => {
    const declaredLen = FRAME_MAX_BYTES + 1024;
    const header = new Uint8Array([
      (declaredLen >>> 24) & 0xff,
      (declaredLen >>> 16) & 0xff,
      (declaredLen >>> 8) & 0xff,
      declaredLen & 0xff,
    ]);
    const junk = new Uint8Array(declaredLen).fill(0x41);
    const next = encodeFrame({ t: 'after-oversized' });
    if (!next.ok) throw new Error('setup failed');

    const decoder = new FrameDecoder();
    const collected: FrameEvent[] = [];
    collected.push(...decoder.push(header));
    collected.push(...decoder.push(junk));
    collected.push(...decoder.push(next.value));

    const errors = errorsOf(collected);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ kind: 'error', error: { code: 'oversized_frame' } });
    // Decoder resynced — the well-formed frame after the oversized one
    // still decodes correctly.
    expect(framesOf(collected)).toEqual([{ t: 'after-oversized' }]);
  });

  it('handles an oversized declared length that itself arrives fragmented', () => {
    const declaredLen = FRAME_MAX_BYTES * 2;
    const header = new Uint8Array([
      (declaredLen >>> 24) & 0xff,
      (declaredLen >>> 16) & 0xff,
      (declaredLen >>> 8) & 0xff,
      declaredLen & 0xff,
    ]);
    const decoder = new FrameDecoder();
    const events1 = decoder.push(header);
    expect(errorsOf(events1).length).toBe(1);
    // Skip the declared bytes in dribs — decoder must not re-emit the error.
    const events2 = decoder.push(new Uint8Array(declaredLen / 2));
    const events3 = decoder.push(new Uint8Array(declaredLen / 2));
    expect(errorsOf([...events2, ...events3]).length).toBe(0);
  });

  it('emits malformed_json for a frame whose bytes are not valid JSON, then keeps decoding', () => {
    const badJson = new TextEncoder().encode('{not json');
    const header = new Uint8Array([0, 0, 0, badJson.length]);
    const good = encodeFrame({ t: 'still-fine' });
    if (!good.ok) throw new Error('setup failed');

    const decoder = new FrameDecoder();
    const collected: FrameEvent[] = [
      ...decoder.push(header),
      ...decoder.push(badJson),
      ...decoder.push(good.value),
    ];

    const errors = errorsOf(collected);
    expect(errors.length).toBe(1);
    expect(errors[0]).toMatchObject({ kind: 'error', error: { code: 'malformed_json' } });
    expect(framesOf(collected)).toEqual([{ t: 'still-fine' }]);
  });

  it('emits invalid_frame_shape for well-formed JSON that is not an object (array/number/string)', () => {
    for (const value of [[1, 2, 3], 42, '"just a string"', 'null']) {
      const json = typeof value === 'string' ? value : JSON.stringify(value);
      const bytes = new TextEncoder().encode(json);
      const header = new Uint8Array(4);
      header[3] = bytes.length; // small payloads only in this test — fits one byte

      const decoder = new FrameDecoder();
      const events = decoder.push(header);
      const events2 = decoder.push(bytes);
      const all = [...events, ...events2];
      expect(errorsOf(all)).toHaveLength(1);
      expect(errorsOf(all)[0]).toMatchObject({ error: { code: 'invalid_frame_shape' } });
    }
  });

  it('never throws on adversarial input', () => {
    const decoder = new FrameDecoder();
    expect(() => decoder.push(new Uint8Array([255, 255, 255, 255, 1, 2, 3]))).not.toThrow();
    expect(() => decoder.push(new Uint8Array(0))).not.toThrow();
    expect(() => decoder.push(new Uint8Array([0, 0, 0, 0]))).not.toThrow(); // zero-length frame
  });

  it('decodes a valid zero-length frame ({}) cleanly', () => {
    const encoded = encodeFrame({});
    if (!encoded.ok) throw new Error('setup failed');
    const decoder = new FrameDecoder();
    expect(framesOf(decoder.push(encoded.value))).toEqual([{}]);
  });
});
