/**
 * Parity test — QR chunking
 *
 * Reads Swift-produced frames (FixtureExporter.test_exportQrChunkFrames)
 * and asserts the TS reassembler reconstructs the original payload
 * byte-for-byte.
 *
 * Reverse direction (TS makes frames, Swift ingests) lives in
 * apps/expo/__tests__/unit/qrChunking.test.ts because the Swift side has
 * its own XCTest for that direction; we don't need cross-build tests for it.
 */
import { describe, expect, it } from 'bun:test';

import { QrChunkReassembler } from '@solidarity/shared';

import fixture from '../../../../packages/parity-fixtures/fixtures/qr/chunking_round_trip.json' assert { type: 'json' };

interface QrCase {
  readonly name: string;
  readonly payload: string;
  readonly chunkBytes: number;
  readonly frames: readonly string[];
}

const cases = (fixture as { readonly cases: readonly QrCase[] }).cases;

describe('QR chunking parity: Swift frames ↔ TS reassembler', () => {
  for (const c of cases) {
    it(`reassembles ${c.frames.length} Swift frames: ${c.name}`, () => {
      const reassembler = new QrChunkReassembler();
      let completedPayload: string | null = null;
      for (const frame of c.frames) {
        const r = reassembler.ingest(frame);
        if (r.kind === 'complete') completedPayload = r.payload;
      }
      expect(completedPayload).toBe(c.payload);
    });

    it(`handles out-of-order Swift frames: ${c.name}`, () => {
      const reassembler = new QrChunkReassembler();
      const shuffled = [...c.frames].reverse();
      let completedPayload: string | null = null;
      for (const frame of shuffled) {
        const r = reassembler.ingest(frame);
        if (r.kind === 'complete') completedPayload = r.payload;
      }
      expect(completedPayload).toBe(c.payload);
    });
  }
});
