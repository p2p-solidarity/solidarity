/**
 * uuid() helper — guards the RN polyfill gap where
 * `crypto.randomUUID` is missing but `crypto.getRandomValues` is present
 * (react-native-get-random-values). The Swift app expects v4-format
 * UUIDs everywhere (UUID().uuidString); this test pins the format.
 */
import { describe, expect, test } from 'bun:test';

import { uuid } from '@solidarity/shared';

const V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid()', () => {
  test('returns canonical 36-char lowercase v4 UUID', () => {
    const id = uuid();
    expect(id).toHaveLength(36);
    expect(id).toMatch(V4_REGEX);
  });

  test('generates distinct values across calls', () => {
    const set = new Set<string>();
    for (let i = 0; i < 512; i += 1) set.add(uuid());
    expect(set.size).toBe(512);
  });

  test('falls back to getRandomValues when randomUUID is unavailable', () => {
    // Simulate React Native: polyfill provides getRandomValues but no randomUUID.
    const desc = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID');
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    try {
      const id = uuid();
      expect(id).toMatch(V4_REGEX);
    } finally {
      if (desc) Object.defineProperty(globalThis.crypto, 'randomUUID', desc);
    }
  });

  test('throws when no crypto source is available', () => {
    const originalCrypto = globalThis.crypto;
    (globalThis as { crypto?: Crypto }).crypto = undefined;
    try {
      expect(() => uuid()).toThrow(/crypto\.getRandomValues/);
    } finally {
      (globalThis as { crypto?: Crypto }).crypto = originalCrypto;
    }
  });
});
