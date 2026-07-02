/**
 * canonical.ts — deterministic JSON (recursive key sort). Moved here from
 * apps/expo/src/dag/node.ts (task A1.1); dag/node.ts now re-exports this
 * implementation instead of owning it.
 *
 * apps/expo/__tests__/unit/dagNode.test.ts already covers the DAG-facing
 * behavior end to end through the re-export — these tests exercise the
 * primitive directly plus a few cases not already covered there (key-order
 * equivalence, unicode, nested arrays-of-objects).
 */
import { describe, expect, test } from 'bun:test';

import { stableJSON } from '../src/canonical';

describe('stableJSON — recursive key sort', () => {
  test('sorts top-level and nested object keys', () => {
    expect(stableJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableJSON({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  test('arrays preserve element order; objects inside arrays still sort', () => {
    expect(stableJSON([3, 1, { b: 1, a: 2 }])).toBe('[3,1,{"a":2,"b":1}]');
  });

  test('primitives / null match JSON.stringify', () => {
    expect(stableJSON(null)).toBe('null');
    expect(stableJSON(0)).toBe('0');
    expect(stableJSON('x')).toBe('"x"');
    expect(stableJSON(true)).toBe('true');
  });

  test('two logically-equal objects with different key insertion order canonicalize identically', () => {
    const a = { alg: 'ES256', kid: 'did:key:z1#0', nested: { y: 2, x: 1 } };
    const b = { nested: { x: 1, y: 2 }, kid: 'did:key:z1#0', alg: 'ES256' };
    expect(stableJSON(a)).toBe(stableJSON(b));
  });

  test('unicode strings are escaped consistently with JSON.stringify', () => {
    expect(stableJSON({ name: '花子' })).toBe(JSON.stringify({ name: '花子' }));
  });

  test('deeply nested arrays-of-objects sort each object independently', () => {
    const value = {
      list: [
        { b: 1, a: 2 },
        { d: 4, c: 3 },
      ],
    };
    expect(stableJSON(value)).toBe('{"list":[{"a":2,"b":1},{"c":3,"d":4}]}');
  });
});
