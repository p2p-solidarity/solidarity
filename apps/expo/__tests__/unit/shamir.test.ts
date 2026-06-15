/**
 * Shamir secret sharing — split/combine round-trip + threshold semantics.
 */
import { describe, expect, it } from 'bun:test';

import { bytesToHex, combine, hexToBytes, split } from '@solidarity/shared';

const SECRET = hexToBytes('00112233445566778899aabbccddeeff');

describe('Shamir SSS', () => {
  it('round-trips a 16-byte secret with (3, 5)', () => {
    const shares = split(SECRET, 3, 5);
    const recovered = combine(shares.slice(0, 3));
    expect(bytesToHex(recovered)).toBe(bytesToHex(SECRET));
  });

  it('recovers with any subset of >= threshold shares', () => {
    const shares = split(SECRET, 3, 5);
    for (const subset of [
      [shares[0]!, shares[1]!, shares[2]!],
      [shares[0]!, shares[2]!, shares[4]!],
      [shares[1]!, shares[3]!, shares[4]!],
    ]) {
      expect(bytesToHex(combine(subset))).toBe(bytesToHex(SECRET));
    }
  });

  it('fewer than threshold shares yields garbage', () => {
    const shares = split(SECRET, 3, 5);
    const tooFew = combine(shares.slice(0, 2));
    expect(bytesToHex(tooFew)).not.toBe(bytesToHex(SECRET));
  });

  it('rejects bad parameters', () => {
    expect(() => split(SECRET, 1, 3)).toThrow();
    expect(() => split(SECRET, 4, 3)).toThrow();
    expect(() => split(SECRET, 2, 256)).toThrow();
  });

  it('handles a single-byte secret', () => {
    const single = new Uint8Array([42]);
    const shares = split(single, 2, 3);
    expect(combine(shares.slice(0, 2))[0]).toBe(42);
  });
});
