import { describe, expect, it } from 'bun:test';

import { deflateSync } from 'fflate';

import { base64UrlEncode, utf8ToBytes, bytesToUtf8 } from '@solidarity/shared';

import {
  MAX_QR_REASSEMBLED_BYTES,
  compressForQR,
  decompressQR,
} from '../../src/cards/qrCompression';

describe('qrCompression (`sce1:` Swift parity)', () => {
  it('exposes the Swift 256 KiB cap', () => {
    expect(MAX_QR_REASSEMBLED_BYTES).toBe(256 * 1024);
  });

  it('round-trips a JSON payload that compresses well', () => {
    const proofChunks = Array.from({ length: 500 }, () => '0123456789abcdef');
    const vp = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      holder: 'did:key:z6MkHolder',
      proof_type: 'mopro-noir',
      selected_claims: ['field_name', 'is_human', 'age_over_18'],
      type: ['VerifiablePresentation'],
      verifiableCredential: [{ proof: proofChunks, publicSignals: proofChunks }],
    };
    const json = JSON.stringify(vp);
    const source = utf8ToBytes(json);

    const framed = compressForQR(source);
    expect(framed).not.toBeNull();
    expect(framed!.startsWith('sce1:')).toBe(true);
    expect(framed!.length).toBeLessThan(source.length);

    const decoded = decompressQR(framed!);
    expect(decoded).not.toBeNull();
    expect(decoded!).toEqual(source);
    expect(bytesToUtf8(decoded!)).toBe(json);
  });

  it('round-trips when input is a string (UTF-8 path)', () => {
    const json = JSON.stringify({ x: 'a'.repeat(2000) });
    const framed = compressForQR(json);
    expect(framed).not.toBeNull();
    const decoded = decompressQR(framed!);
    expect(decoded).not.toBeNull();
    expect(bytesToUtf8(decoded!)).toBe(json);
  });

  it('returns null when compression would not shrink the payload', () => {
    // "hello world" → 11 src bytes, ~13 deflate bytes, framed length > 11.
    expect(compressForQR('hello world')).toBeNull();
    // Empty input: nothing to compress.
    expect(compressForQR(new Uint8Array(0))).toBeNull();
    expect(compressForQR('')).toBeNull();
  });

  it('matches a fixed deterministic test vector (catches algorithm drift)', () => {
    // A repeating string deflates to a tiny, deterministic byte sequence.
    // If a future fflate or alphabet change breaks this, Swift parity is gone.
    const source = 'A'.repeat(100);
    expect(compressForQR(source)).toBe('sce1:c6QDAAA');
  });

  it('rejects input without the `sce1:` prefix', () => {
    expect(decompressQR('hello')).toBeNull();
    expect(decompressQR('')).toBeNull();
    expect(decompressQR('sce2:abc')).toBeNull();
    expect(decompressQR('sce1')).toBeNull(); // missing colon
    expect(decompressQR('sce1:')).toBeNull(); // empty payload
  });

  it('rejects non-string payloads', () => {
    // Defensive — the type system forbids it, but runtime call sites
    // could still feed us garbage from network code.
    expect(decompressQR(null as unknown as string)).toBeNull();
    expect(decompressQR(undefined as unknown as string)).toBeNull();
    expect(decompressQR(123 as unknown as string)).toBeNull();
  });

  it('rejects malformed base64url after the prefix', () => {
    // `!` is not in either RFC 4648 alphabet.
    expect(decompressQR('sce1:!!!!')).toBeNull();
    // Even valid base64url that is not valid deflate inflates to nothing.
    expect(decompressQR('sce1:AAAA')).toBeNull();
  });

  it('rejects compressed input larger than the cap without inflating', () => {
    // Build a base64url string that decodes to > MAX bytes of garbage.
    // We don't need real deflate — the length guard fires first.
    const oversized = new Uint8Array(MAX_QR_REASSEMBLED_BYTES + 64);
    oversized.fill(0xff);
    const framed = `sce1:${base64UrlEncode(oversized)}`;
    expect(decompressQR(framed)).toBeNull();
  });

  it('rejects inputs whose decompressed output hits the cap (zip-bomb guard)', () => {
    // Construct an input that decompresses to > MAX bytes. A long run of a
    // single byte compresses extremely well, so a few KB of compressed bytes
    // can expand to many MB. Deflate is enough to demonstrate truncation.
    const huge = new Uint8Array(MAX_QR_REASSEMBLED_BYTES + 4096);
    huge.fill(0x41);
    const compressed = deflateSync(huge);
    // Sanity check: compressed must still fit under the input cap so we
    // exercise the *output* cap (not the input cap).
    expect(compressed.length).toBeLessThan(MAX_QR_REASSEMBLED_BYTES);
    const framed = `sce1:${base64UrlEncode(compressed)}`;
    expect(decompressQR(framed)).toBeNull();
  });

  it('compressForQR + decompressQR is idempotent on round-trip', () => {
    const original = JSON.stringify({
      items: Array.from({ length: 200 }, (_, i) => ({ id: i, tag: 'solidarity' })),
    });
    const framed = compressForQR(original);
    expect(framed).not.toBeNull();
    const first = decompressQR(framed!);
    expect(first).not.toBeNull();
    const reframed = compressForQR(first!);
    expect(reframed).toBe(framed);
  });
});
