/**
 * DAG sync — three-step protocol convergence + bad-input handling.
 * Spec: docs/dev-sandbox-identity-graph.md §3.3.
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
import {
  buildHeadsFrame,
  buildNodeFramesForWant,
  ingestNodeFrame,
  processHeadsAndBuildWant,
  runSyncStep,
} from '@/dag/sync';
import {
  FRAME_KIND_HEADS,
  FRAME_KIND_NODE,
  FRAME_KIND_WANT,
  decodeHashList,
  drainDagFrames,
} from '@/dag/wire';

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

describe('dagSync — building frames', () => {
  test('buildHeadsFrame encodes current store heads', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const root = build(0x01, [], { peer_did: 'did:key:zA' });
    store.appendNode(root);
    const frame = buildHeadsFrame(store);
    const { dag } = drainDagFrames(frame);
    expect(dag.length).toBe(1);
    expect(dag[0]?.kind).toBe(FRAME_KIND_HEADS);
    expect(decodeHashList(dag[0]!.body)).toEqual([root.id]);
  });

  test('processHeadsAndBuildWant requests only ids we lack', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const a = build(0x01, [], { peer_did: 'did:key:zA' });
    const b = build(0x01, [], { peer_did: 'did:key:zB' }, 1_700_000_001);
    const c = build(0x01, [], { peer_did: 'did:key:zC' }, 1_700_000_002);
    store.appendNode(a);
    // peer claims to hold a, b, c — we only have a; WANT should be [b, c]
    const { wantFrame, missingIds } = processHeadsAndBuildWant(store, [a.id, b.id, c.id]);
    expect(missingIds).toEqual([b.id, c.id]);
    const { dag } = drainDagFrames(wantFrame);
    expect(dag[0]?.kind).toBe(FRAME_KIND_WANT);
    expect(decodeHashList(dag[0]!.body)).toEqual([b.id, c.id]);
  });

  test('buildNodeFramesForWant produces one frame per held id, skips unknown', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const a = build(0x01, [], { peer_did: 'did:key:zA' });
    store.appendNode(a);
    const ghostId = 'f'.repeat(64);
    const frames = buildNodeFramesForWant(store, [a.id, ghostId]);
    expect(frames.length).toBe(1);
    const concat = new Uint8Array(frames[0]!.length);
    concat.set(frames[0]!, 0);
    const { dag } = drainDagFrames(concat);
    expect(dag[0]?.kind).toBe(FRAME_KIND_NODE);
  });
});

describe('dagSync — runSyncStep dispatch', () => {
  test('HEADS in → WANT out for the missing ids', () => {
    const peerStore = createDagStore(new InMemoryDagBackend());
    const localStore = createDagStore(new InMemoryDagBackend());
    const a = build(0x01, [], { peer_did: 'did:key:zA' });
    const b = build(0x01, [], { peer_did: 'did:key:zB' }, 1_700_000_001);
    peerStore.appendNode(a);
    peerStore.appendNode(b);
    const headsFrame = buildHeadsFrame(peerStore);
    const { dag: peerFrames } = drainDagFrames(headsFrame);
    const res = runSyncStep(localStore, peerFrames);
    expect(res.outboundFrames.length).toBe(1);
    const wantBuf = new Uint8Array(res.outboundFrames[0]!.length);
    wantBuf.set(res.outboundFrames[0]!, 0);
    const { dag: wantFrames } = drainDagFrames(wantBuf);
    expect(wantFrames[0]?.kind).toBe(FRAME_KIND_WANT);
    expect(decodeHashList(wantFrames[0]!.body).length).toBe(2);
  });

  test('NODE in → store appended, no outbound', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    const nodeJson = JSON.stringify(node);
    const r = ingestNodeFrame(store, nodeJson);
    expect(r.kind).toBe('inserted');
    expect(store.hasNode(node.id)).toBe(true);
  });

  test('bad NODE JSON surfaces an error, no insertion', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const r = ingestNodeFrame(store, 'not json');
    expect(r.kind).toBe('parseError');
    expect(store.count()).toBe(0);
  });

  test('tampered NODE (id mismatch) rejected with invalid reason', () => {
    const store = createDagStore(new InMemoryDagBackend());
    const node = build(0x01, [], { peer_did: 'did:key:zA' });
    const tampered = { ...node, payload: { peer_did: 'did:key:zEVIL' } };
    const r = ingestNodeFrame(store, JSON.stringify(tampered));
    if (r.kind !== 'invalid') throw new Error('expected invalid');
    expect(r.reason).toMatch(/canonical recomputation/);
  });
});

describe('dagSync — convergence (peer A ↔ peer B)', () => {
  test('one full round transfers all heads; second round confirms quiescence', () => {
    const A = createDagStore(new InMemoryDagBackend());
    const B = createDagStore(new InMemoryDagBackend());
    // A has nodes 1, 2; B has nothing.
    const n1 = build(0x01, [], { peer_did: 'did:key:zA' }, 1_700_000_000);
    const n2 = build(0x01, [n1.id], { peer_did: 'did:key:zB' }, 1_700_000_001);
    A.appendNode(n1);
    A.appendNode(n2);

    // Round 1: A → HEADS → B. B asks for what it lacks.
    const aHeadsFrame = buildHeadsFrame(A);
    const { dag: aHeadsFrames } = drainDagFrames(aHeadsFrame);
    const r1 = runSyncStep(B, aHeadsFrames);
    // B should WANT n2 (A's only HEAD).
    expect(r1.outboundFrames.length).toBe(1);
    const wantBuf = new Uint8Array(r1.outboundFrames[0]!.length);
    wantBuf.set(r1.outboundFrames[0]!, 0);
    const { dag: wantFrames } = drainDagFrames(wantBuf);
    expect(decodeHashList(wantFrames[0]!.body)).toEqual([n2.id]);

    // A receives WANT and emits NODE for n2.
    const r2 = runSyncStep(A, wantFrames);
    expect(r2.outboundFrames.length).toBe(1);

    // B receives NODE, appends n2 (which references n1 as parent — still missing).
    const nodeBuf = new Uint8Array(r2.outboundFrames[0]!.length);
    nodeBuf.set(r2.outboundFrames[0]!, 0);
    const { dag: nodeFrames } = drainDagFrames(nodeBuf);
    const r3 = runSyncStep(B, nodeFrames);
    expect(r3.insertedNodeIds).toEqual([n2.id]);

    // Round 2: B → HEADS → A. B's new HEAD is n2; A has n2 → no diff → A sends empty WANT.
    const bHeadsFrame = buildHeadsFrame(B);
    const { dag: bHeadsFrames } = drainDagFrames(bHeadsFrame);
    const r4 = runSyncStep(A, bHeadsFrames);
    expect(r4.outboundFrames.length).toBe(1);
    const ackBuf = new Uint8Array(r4.outboundFrames[0]!.length);
    ackBuf.set(r4.outboundFrames[0]!, 0);
    const { dag: ackFrames } = drainDagFrames(ackBuf);
    expect(ackFrames[0]?.kind).toBe(FRAME_KIND_WANT);
    expect(decodeHashList(ackFrames[0]!.body).length).toBe(0); // empty WANT = quiescent

    // n1 is still missing on B (B only knows about n2's HEAD). A second
    // round driven by B re-asks via WANT for n2.parents — that's the
    // multi-round convergence noted in the file header. Verify B still
    // lacks n1 after the first round.
    expect(B.hasNode(n2.id)).toBe(true);
    expect(B.hasNode(n1.id)).toBe(false);
  });
});
