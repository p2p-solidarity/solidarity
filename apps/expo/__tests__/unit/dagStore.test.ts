/**
 * DAG store — append / HEAD tracking / dup + invalid handling.
 * Spec: docs/dev-sandbox-identity-graph.md §3.2 + §6.
 */
import { describe, expect, test } from 'bun:test';
import { schnorr } from '@noble/curves/secp256k1.js';

import {
  type DagNodeUnsigned,
  KIND_DAG_NODE,
  hexEncode,
  signNode,
} from '@/dag/node';
import { InMemoryDagBackend, createDagStore } from '@/dag/store';

function makeKeypair(seed: number): { privkey: Uint8Array; pubkeyHex: string } {
  const privkey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) privkey[i] = (seed + i) & 0xff;
  return { privkey, pubkeyHex: hexEncode(schnorr.getPublicKey(privkey)) };
}

function build(seed: number, parents: readonly string[], payload: Record<string, unknown>, ts = 1_700_000_000) {
  const { privkey, pubkeyHex } = makeKeypair(seed);
  const unsigned: DagNodeUnsigned = {
    author: pubkeyHex,
    parents,
    kind: KIND_DAG_NODE,
    action: 'exchange',
    payload,
    created_at: ts,
  };
  return signNode(unsigned, privkey);
}

describe('dagStore — append flow', () => {
  test('first insert succeeds; HEAD = just that id', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    expect(store.appendNode(node)).toEqual({ kind: 'inserted' });
    expect(store.heads()).toEqual([node.id]);
    expect(store.count()).toBe(1);
    expect(store.hasNode(node.id)).toBe(true);
    expect(store.getNode(node.id)?.id).toBe(node.id);
  });

  test('appending a child removes parent from HEADs', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const root = build(0x01, [], { peer_did: 'did:key:zA' });
    store.appendNode(root);
    const child = build(0x01, [root.id], { peer_did: 'did:key:zB' }, 1_700_000_001);
    expect(store.appendNode(child)).toEqual({ kind: 'inserted' });
    expect(store.heads()).toEqual([child.id]);
    expect(store.count()).toBe(2);
  });

  test('two children of one root = two HEADs (fork)', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const root = build(0x01, [], { peer_did: 'did:key:zA' });
    store.appendNode(root);
    const a = build(0x01, [root.id], { peer_did: 'did:key:zB' }, 1_700_000_001);
    const b = build(0x01, [root.id], { peer_did: 'did:key:zC' }, 1_700_000_002);
    store.appendNode(a);
    store.appendNode(b);
    const headsSet = new Set(store.heads());
    expect(headsSet.has(a.id)).toBe(true);
    expect(headsSet.has(b.id)).toBe(true);
    expect(headsSet.has(root.id)).toBe(false);
  });

  test('duplicate id rejected as duplicate, not inserted twice', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    expect(store.appendNode(node).kind).toBe('inserted');
    expect(store.appendNode(node).kind).toBe('duplicate');
    expect(store.count()).toBe(1);
  });
});

describe('dagStore — invalid rejections', () => {
  test('bad id length', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    const bad = { ...node, id: 'abcd' };
    const r = store.appendNode(bad);
    if (r.kind !== 'invalid') throw new Error('expected invalid');
    expect(r.reason).toMatch(/64-char/);
  });

  test('id mismatch (tampered payload but same id)', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    const bad = { ...node, payload: { peer_did: 'did:key:zEVIL' } };
    const r = store.appendNode(bad);
    if (r.kind !== 'invalid') throw new Error('expected invalid');
    expect(r.reason).toMatch(/canonical recomputation/);
  });

  test('signature mismatch (flipped sig hex)', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    const flipped = node.sig.startsWith('a') ? 'b' + node.sig.slice(1) : 'a' + node.sig.slice(1);
    const bad = { ...node, sig: flipped };
    const r = store.appendNode(bad);
    if (r.kind !== 'invalid') throw new Error('expected invalid');
    // The id check happens before the sig check, so a flipped sig still
    // produces a matching id; the rejection reason is the schnorr verify
    // failure.
    expect(r.reason).toMatch(/schnorr/);
  });
});

describe('dagStore — clear + allNodes', () => {
  test('clear wipes nodes + HEADs', () => {
    const store = createDagStore(new InMemoryDagBackend());
    store.appendNode(build(0x01, [], { peer_did: 'did:key:zA' }));
    store.appendNode(build(0x01, [], { peer_did: 'did:key:zB' }, 1_700_000_002));
    expect(store.count()).toBe(2);
    store.clear();
    expect(store.count()).toBe(0);
    expect(store.heads()).toEqual([]);
  });

  test('allNodes returns every inserted node (order may vary)', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const a = build(0x01, [], { peer_did: 'did:key:zA' });
    const b = build(0x01, [], { peer_did: 'did:key:zB' }, 1_700_000_002);
    store.appendNode(a);
    store.appendNode(b);
    const ids = new Set(store.allNodes().map((n) => n.id));
    expect(ids.size).toBe(2);
    expect(ids.has(a.id)).toBe(true);
    expect(ids.has(b.id)).toBe(true);
  });
});
