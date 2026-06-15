/**
 * Nostr adapter — projection + HEAD pointer event + verification tests.
 * Spec: docs/dev-sandbox-identity-graph.md §3.4 + §6.2.
 *
 * Publish/subscribe paths use WebSocket which the Bun harness can't
 * stub easily — those are covered by the Lab UI's round-trip test.
 */
import { describe, expect, test } from 'bun:test';
import { schnorr } from '@noble/curves/secp256k1.js';

import {
  KIND_DAG_HEAD,
  KIND_DAG_NODE,
  type DagNodeUnsigned,
  hexEncode,
  signNode,
  verifyNode,
} from '@/dag/node';
import {
  NIP78_D_TAG,
  buildHeadPointerEvent,
  dagNodeToNostrEvent,
  verifyNostrEvent,
} from '@/dag/nostrAdapter';

function makeKeypair(seed: number): { privkey: Uint8Array; pubkeyHex: string } {
  const privkey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) privkey[i] = (seed + i) & 0xff;
  return { privkey, pubkeyHex: hexEncode(schnorr.getPublicKey(privkey)) };
}

describe('nostrAdapter.dagNodeToNostrEvent — bidirectional id + sig parity', () => {
  test('projected event verifies under verifyNostrEvent (same id + sig as the DAG node)', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x11);
    const unsigned: DagNodeUnsigned = {
      author: pubkeyHex,
      parents: ['a'.repeat(64)],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: { peer_did: 'did:key:zX', note: 'hi' },
      created_at: 1_700_100_000,
    };
    const node = signNode(unsigned, privkey);
    expect(verifyNode(node)).toBe(true);
    const ev = dagNodeToNostrEvent(node);
    expect(ev.id).toBe(node.id);
    expect(ev.pubkey).toBe(node.author);
    expect(ev.sig).toBe(node.sig);
    expect(ev.created_at).toBe(node.created_at);
    expect(verifyNostrEvent(ev)).toBe(true);
  });

  test('tampered content fails verifyNostrEvent', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x11);
    const node = signNode({
      author: pubkeyHex,
      parents: [],
      kind: KIND_DAG_NODE,
      action: 'exchange',
      payload: { peer_did: 'did:key:zX' },
      created_at: 1_700_100_000,
    }, privkey);
    const ev = dagNodeToNostrEvent(node);
    const tampered = { ...ev, content: ev.content + 'EVIL' };
    expect(verifyNostrEvent(tampered)).toBe(false);
  });
});

describe('nostrAdapter.buildHeadPointerEvent — NIP-78 kind 30078 with d-tag', () => {
  test('event has the expected shape and verifies', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const heads = ['a'.repeat(64), 'b'.repeat(64)];
    const ev = buildHeadPointerEvent(privkey, pubkeyHex, heads, 1_700_200_000);
    expect(ev.kind).toBe(KIND_DAG_HEAD);
    expect(ev.kind).toBe(30078);
    expect(ev.pubkey).toBe(pubkeyHex);
    expect(ev.created_at).toBe(1_700_200_000);
    expect(ev.tags[0]).toEqual(['d', NIP78_D_TAG]);
    expect(ev.tags[1]).toEqual(['e', 'a'.repeat(64)]);
    expect(ev.tags[2]).toEqual(['e', 'b'.repeat(64)]);
    expect(JSON.parse(ev.content)).toEqual({ head_count: 2, v: 1 });
    expect(verifyNostrEvent(ev)).toBe(true);
  });

  test('empty heads list still produces a valid event', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const ev = buildHeadPointerEvent(privkey, pubkeyHex, [], 1_700_200_000);
    expect(ev.tags.length).toBe(1);
    expect(ev.tags[0]).toEqual(['d', NIP78_D_TAG]);
    expect(verifyNostrEvent(ev)).toBe(true);
  });

  test('different head sets produce different ids', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x42);
    const a = buildHeadPointerEvent(privkey, pubkeyHex, ['a'.repeat(64)], 1_700_200_000);
    const b = buildHeadPointerEvent(privkey, pubkeyHex, ['b'.repeat(64)], 1_700_200_000);
    expect(a.id).not.toBe(b.id);
  });
});

describe('nostrAdapter.verifyNostrEvent — basic invariants', () => {
  test('rejects bad sig length / malformed hex without throwing', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x88);
    const ev = buildHeadPointerEvent(privkey, pubkeyHex, [], 1_700_200_000);
    expect(verifyNostrEvent({ ...ev, sig: 'zz' })).toBe(false);
    expect(verifyNostrEvent({ ...ev, id: 'zz' })).toBe(false);
    expect(verifyNostrEvent({ ...ev, pubkey: 'zz' })).toBe(false);
  });

  test('flipping a tag changes the computed id, fails verify', () => {
    const { privkey, pubkeyHex } = makeKeypair(0x88);
    const ev = buildHeadPointerEvent(privkey, pubkeyHex, ['a'.repeat(64)], 1_700_200_000);
    const tampered = { ...ev, tags: [...ev.tags, ['x', 'extra']] };
    expect(verifyNostrEvent(tampered)).toBe(false);
  });
});
