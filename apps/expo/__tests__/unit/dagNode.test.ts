/**
 * DAG node — canonical serialization, deterministic id, sign / verify.
 * Spec: docs/ref/notes-dev-sandbox-identity-graph.md §6.
 */
import { describe, expect, test } from 'bun:test';
import { schnorr } from '@noble/curves/secp256k1.js';

import {
  type DagNodeUnsigned,
  KIND_DAG_NODE,
  canonicalSerialization,
  computeNodeId,
  hexEncode,
  nostrTagsFor,
  signNode,
  stableJSON,
  verifyNode,
} from '@/dag/node';

function makeKeypair(seed: number): { privkey: Uint8Array; pubkeyHex: string } {
  const privkey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) privkey[i] = (seed + i) & 0xff;
  const pub = schnorr.getPublicKey(privkey);
  return { privkey, pubkeyHex: hexEncode(pub) };
}

describe('dagNode.stableJSON — recursive key sort, deterministic output', () => {
  test('object keys sorted regardless of insertion order', () => {
    expect(stableJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableJSON({ z: { y: 1, x: 2 }, a: 3 })).toBe('{"a":3,"z":{"x":2,"y":1}}');
  });

  test('arrays preserve order; nested objects sort', () => {
    expect(stableJSON([3, 1, { b: 1, a: 2 }])).toBe('[3,1,{"a":2,"b":1}]');
  });

  test('null / undefined / primitives match JSON.stringify', () => {
    expect(stableJSON(null)).toBe('null');
    expect(stableJSON(0)).toBe('0');
    expect(stableJSON('x')).toBe('"x"');
    expect(stableJSON(true)).toBe('true');
  });
});

describe('dagNode.nostrTagsFor — parent ids → e-tags, action → a-tag', () => {
  const base: DagNodeUnsigned = {
    author: 'a'.repeat(64),
    parents: ['1'.repeat(64), '2'.repeat(64)],
    kind: KIND_DAG_NODE,
    action: 'exchange',
    payload: { peer_did: 'did:key:z1' },
    created_at: 1_700_000_000,
  };

  test('one e-tag per parent in input order, one a-tag for action', () => {
    const tags = nostrTagsFor(base);
    expect(tags.length).toBe(3);
    expect(tags[0]).toEqual(['e', '1'.repeat(64), '', 'reply']);
    expect(tags[1]).toEqual(['e', '2'.repeat(64), '', 'reply']);
    expect(tags[2]).toEqual(['a', 'solidarity-action', 'exchange']);
  });

  test('root node (no parents) still gets the a-tag', () => {
    const tags = nostrTagsFor({ ...base, parents: [] });
    expect(tags.length).toBe(1);
    expect(tags[0]).toEqual(['a', 'solidarity-action', 'exchange']);
  });
});

describe('dagNode.computeNodeId — deterministic id, payload-order-insensitive', () => {
  const base: DagNodeUnsigned = {
    author: 'a'.repeat(64),
    parents: [],
    kind: KIND_DAG_NODE,
    action: 'exchange',
    payload: { peer_did: 'did:key:z1', ts: 1_700_000_000 },
    created_at: 1_700_000_000,
  };

  test('same input → same id', () => {
    const id1 = computeNodeId(base);
    const id2 = computeNodeId(base);
    expect(id1).toBe(id2);
    expect(id1.length).toBe(64);
  });

  test('different payload key order → same id (stableJSON canonicalizes)', () => {
    const reordered: DagNodeUnsigned = { ...base, payload: { ts: 1_700_000_000, peer_did: 'did:key:z1' } };
    expect(computeNodeId(reordered)).toBe(computeNodeId(base));
  });

  test('changing any field changes the id', () => {
    const base_id = computeNodeId(base);
    expect(computeNodeId({ ...base, action: 'attended' })).not.toBe(base_id);
    expect(computeNodeId({ ...base, created_at: 1_700_000_001 })).not.toBe(base_id);
    expect(computeNodeId({ ...base, kind: 1064 })).not.toBe(base_id);
    expect(computeNodeId({ ...base, parents: ['z'.repeat(64)] })).not.toBe(base_id);
    expect(computeNodeId({ ...base, payload: { peer_did: 'did:key:z2', ts: 1_700_000_000 } })).not.toBe(base_id);
  });

  test('canonicalSerialization shape — NIP-01 outer array verbatim', () => {
    const s = canonicalSerialization(base);
    expect(s.startsWith('[0,"aaaaaaa')).toBe(true);
    expect(s).toContain(',1700000000,');
    expect(s).toContain(',1063,');
    expect(s).toContain('"a","solidarity-action","exchange"');
  });
});

describe('dagNode.signNode / verifyNode — schnorr round-trip', () => {
  test('signed node verifies', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const unsigned: DagNodeUnsigned = {
      author: pubkeyHex,
      parents: [],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: { peer_did: 'did:key:zABC' },
      created_at: 1_700_000_000,
    };
    const node = signNode(unsigned, privkey);
    expect(node.id.length).toBe(64);
    expect(node.sig.length).toBe(128);
    expect(verifyNode(node)).toBe(true);
  });

  test('tampered payload fails verify (id no longer matches recomputation)', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const node = signNode({
      author: pubkeyHex,
      parents: [],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: { peer_did: 'did:key:zABC' },
      created_at: 1_700_000_000,
    }, privkey);
    const tampered = { ...node, payload: { peer_did: 'did:key:zEVIL' } };
    expect(verifyNode(tampered)).toBe(false);
  });

  test('tampered sig fails verify (schnorr rejects)', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const node = signNode({
      author: pubkeyHex,
      parents: [],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: {},
      created_at: 1_700_000_000,
    }, privkey);
    // Flip a hex char in the sig (still valid hex but different signature).
    const flipped = node.sig.startsWith('a') ? 'b' + node.sig.slice(1) : 'a' + node.sig.slice(1);
    expect(verifyNode({ ...node, sig: flipped })).toBe(false);
  });

  test('different author key fails verify (sig was for the original pubkey)', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const { pubkeyHex: pubB } = makeKeypair(0x99);
    const node = signNode({
      author: pubkeyHex,
      parents: [],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: {},
      created_at: 1_700_000_000,
    }, privkey);
    expect(verifyNode({ ...node, author: pubB })).toBe(false);
  });

  test('signNode rejects wrong-length privkey', () => {
    expect(() => signNode({
      author: 'a'.repeat(64),
      parents: [],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: {},
      created_at: 1_700_000_000,
    }, new Uint8Array(31))).toThrow(/32 bytes/);
  });
});

describe('dagNode hex helpers', () => {
  test('encode + decode round-trip', () => {
    const bytes = new Uint8Array([0x00, 0xff, 0x42, 0xab, 0xcd, 0xef]);
    const hex = hexEncode(bytes);
    expect(hex).toBe('00ff42abcdef');
  });

  test('decode rejects odd-length / invalid hex', () => {
    const { hexDecode } = require('@/dag/node') as { hexDecode: (s: string) => Uint8Array };
    expect(() => hexDecode('abc')).toThrow(/even length/);
    expect(() => hexDecode('zz')).toThrow(/invalid hex/);
  });
});
