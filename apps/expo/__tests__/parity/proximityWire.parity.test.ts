/**
 * Proximity L2CAP wire-format parity.
 *
 * These tests pin the bytes both `HybridProximity.swift` (iOS) and
 * `HybridProximity.kt` (Android) produce + consume on the L2CAP data
 * path so a future regression on either native side fails here instead
 * of silently in the field.
 *
 * Native references:
 *   iOS:     nitro-modules/proximity/ios/HybridProximity.swift
 *            (see `frame(_:)`, `drainFrames`, `addGattService`)
 *   Android: nitro-modules/proximity/android/HybridProximity.kt
 *            (length-prefix encode/decode + PSM advert encoding)
 */
import { describe, expect, test } from 'bun:test';

import {
  decodePsm,
  drainFrames,
  encodePsm,
  frameMessage,
  isUnitVector,
  MAX_FRAME_PAYLOAD_BYTES,
  PROXIMITY_INFO_CHAR_UUID,
  PROXIMITY_PSM_CHAR_UUID,
  PROXIMITY_SERVICE_UUID,
  vectorMagnitude,
} from '@/proximity/wire';

describe('shared service / characteristic UUIDs', () => {
  test('service UUID is the version we ship on both platforms', () => {
    // If you change this, update the native constants too:
    //   iOS:     ProximityWire.serviceUUID
    //   Android: ProximityWire.SERVICE_UUID
    expect(PROXIMITY_SERVICE_UUID).toBe('4D2C3A01-7A8D-4F2C-9A2E-B5D2C3A17A8D');
  });

  test('PSM and info characteristic UUIDs sit under the same prefix', () => {
    expect(PROXIMITY_PSM_CHAR_UUID).toBe('4D2C3A02-7A8D-4F2C-9A2E-B5D2C3A17A8D');
    expect(PROXIMITY_INFO_CHAR_UUID).toBe('4D2C3A03-7A8D-4F2C-9A2E-B5D2C3A17A8D');
  });
});

describe('frameMessage', () => {
  test('encodes empty payload as 2 zero bytes', () => {
    const out = frameMessage(new Uint8Array(0));
    expect(Array.from(out)).toEqual([0, 0]);
  });

  test('encodes 5-byte payload with big-endian length prefix', () => {
    const out = frameMessage(new Uint8Array([1, 2, 3, 4, 5]));
    expect(Array.from(out)).toEqual([0, 5, 1, 2, 3, 4, 5]);
  });

  test('handles payload at the uint8 boundary (256 bytes → 0x01 0x00)', () => {
    const payload = new Uint8Array(256).fill(0xab);
    const out = frameMessage(payload);
    expect(out[0]).toBe(0x01);
    expect(out[1]).toBe(0x00);
    expect(out.length).toBe(2 + 256);
  });

  test('throws when payload exceeds uint16 max', () => {
    const payload = new Uint8Array(MAX_FRAME_PAYLOAD_BYTES + 1);
    expect(() => frameMessage(payload)).toThrow(RangeError);
  });

  test('round-trips through drainFrames byte-identically', () => {
    const original = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const framed = frameMessage(original);
    const { frames, rest } = drainFrames(framed);
    expect(frames.length).toBe(1);
    expect(Array.from(frames[0])).toEqual(Array.from(original));
    expect(rest.length).toBe(0);
  });
});

describe('drainFrames', () => {
  test('returns the buffer unchanged when fewer than 2 bytes are present', () => {
    const buf = new Uint8Array([0x05]);
    const { frames, rest } = drainFrames(buf);
    expect(frames.length).toBe(0);
    expect(Array.from(rest)).toEqual([0x05]);
  });

  test('returns buffer unchanged when a partial payload arrives', () => {
    // Declares 5 bytes but only 3 follow → wait for more.
    const partial = new Uint8Array([0x00, 0x05, 0x01, 0x02, 0x03]);
    const { frames, rest } = drainFrames(partial);
    expect(frames.length).toBe(0);
    expect(Array.from(rest)).toEqual(Array.from(partial));
  });

  test('extracts multiple back-to-back frames from a single buffer', () => {
    const a = frameMessage(new Uint8Array([1, 1]));
    const b = frameMessage(new Uint8Array([2, 2, 2]));
    const c = frameMessage(new Uint8Array([3]));
    const combined = new Uint8Array(a.length + b.length + c.length);
    combined.set(a, 0);
    combined.set(b, a.length);
    combined.set(c, a.length + b.length);
    const { frames, rest } = drainFrames(combined);
    expect(frames.length).toBe(3);
    expect(Array.from(frames[0])).toEqual([1, 1]);
    expect(Array.from(frames[1])).toEqual([2, 2, 2]);
    expect(Array.from(frames[2])).toEqual([3]);
    expect(rest.length).toBe(0);
  });

  test('leaves trailing partial frame in `rest` when the last header is incomplete', () => {
    const full = frameMessage(new Uint8Array([1, 2, 3]));
    const trailing = new Uint8Array([0x00, 0x10, 0x99]); // declares 16, only 1 byte
    const combined = new Uint8Array(full.length + trailing.length);
    combined.set(full, 0);
    combined.set(trailing, full.length);
    const { frames, rest } = drainFrames(combined);
    expect(frames.length).toBe(1);
    expect(Array.from(frames[0])).toEqual([1, 2, 3]);
    expect(Array.from(rest)).toEqual([0x00, 0x10, 0x99]);
  });
});

describe('encodePsm / decodePsm', () => {
  test('round-trips a dynamic-PSM value (0x0080)', () => {
    const bytes = encodePsm(0x0080);
    expect(Array.from(bytes)).toEqual([0x80, 0x00]); // little-endian
    expect(decodePsm(bytes)).toBe(0x0080);
  });

  test('round-trips at the uint16 boundary', () => {
    const bytes = encodePsm(0xffff);
    expect(Array.from(bytes)).toEqual([0xff, 0xff]);
    expect(decodePsm(bytes)).toBe(0xffff);
  });

  test('rejects negative or non-integer PSMs', () => {
    expect(() => encodePsm(-1)).toThrow(RangeError);
    expect(() => encodePsm(1.5)).toThrow(RangeError);
    expect(() => encodePsm(0x10000)).toThrow(RangeError);
  });

  test('rejects truncated byte arrays on decode', () => {
    expect(() => decodePsm(new Uint8Array([0x80]))).toThrow(RangeError);
  });
});

describe('vector helpers', () => {
  test('vectorMagnitude computes Euclidean length', () => {
    expect(vectorMagnitude({ x: 3, y: 4, z: 0 })).toBeCloseTo(5);
  });

  test('isUnitVector accepts NI-typical unit vectors within tolerance', () => {
    expect(isUnitVector({ x: 1, y: 0, z: 0 })).toBe(true);
    expect(isUnitVector({ x: 0.6, y: 0.8, z: 0 })).toBe(true);
  });

  test('isUnitVector rejects all-zero vectors (peer still warming up)', () => {
    expect(isUnitVector({ x: 0, y: 0, z: 0 })).toBe(false);
  });
});
