/**
 * DAG replay — LWW + revocation + perf gate.
 * Spec: docs/ref/notes-dev-sandbox-identity-graph.md §6.3, §6.4, §13.3.
 */
import { describe, expect, test } from 'bun:test';

import {
  type DagNode,
  type DagNodeUnsigned,
  KIND_DAG_NODE,
  computeNodeId,
} from '@/dag/node';
import { replay } from '@/dag/replay';

// Replay never verifies signatures — that happened at append time.
// So these fixtures can skip signing and just compute a valid id, then
// stub the sig field. Tests of verification live in dagNode.test.ts.
function stub(
  partial: Omit<DagNodeUnsigned, 'author' | 'kind'> & {
    author?: string;
    kind?: number;
    sig?: string;
  }
): DagNode {
  const unsigned: DagNodeUnsigned = {
    author: partial.author ?? 'a'.repeat(64),
    parents: partial.parents,
    kind: partial.kind ?? KIND_DAG_NODE,
    action: partial.action,
    payload: partial.payload,
    created_at: partial.created_at,
  };
  return {
    ...unsigned,
    id: computeNodeId(unsigned),
    sig: partial.sig ?? '0'.repeat(128),
  };
}

describe('dagReplay — LWW per action key', () => {
  test('two exchange nodes for same peer_did: later created_at wins', () => {
    const earlier = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA', note: 'first' }, created_at: 1_700_000_000 });
    const later = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA', note: 'second' }, created_at: 1_700_000_010 });
    const p = replay([earlier, later]);
    expect(p.exchangeByPeerDid.get('did:key:zA')?.payload['note']).toBe('second');
  });

  test('tie on created_at broken by lexicographic id', () => {
    // Construct two nodes with same ts but different ids — payload differs to ensure id differs.
    const a = stub({ parents: [], action: 'attended', payload: { event_id: 'ev1', note: 'aaaa' }, created_at: 1_700_000_000 });
    const b = stub({ parents: [], action: 'attended', payload: { event_id: 'ev1', note: 'zzzz' }, created_at: 1_700_000_000 });
    const winner = a.id > b.id ? a : b;
    const loser = a.id > b.id ? b : a;
    const p = replay([loser, winner]);
    expect(p.attendedByEventId.get('ev1')?.id).toBe(winner.id);
  });

  test('replay is order-insensitive — three reorderings of same set produce same map', () => {
    const x = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA', v: 1 }, created_at: 1_700_000_000 });
    const y = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA', v: 2 }, created_at: 1_700_000_005 });
    const z = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zB', v: 3 }, created_at: 1_700_000_002 });
    const r1 = replay([x, y, z]);
    const r2 = replay([z, y, x]);
    const r3 = replay([y, x, z]);
    expect(r1.exchangeByPeerDid.get('did:key:zA')?.id).toBe(y.id);
    expect(r2.exchangeByPeerDid.get('did:key:zA')?.id).toBe(y.id);
    expect(r3.exchangeByPeerDid.get('did:key:zA')?.id).toBe(y.id);
    expect(r1.exchangeByPeerDid.get('did:key:zB')?.id).toBe(z.id);
    expect(r2.exchangeByPeerDid.get('did:key:zB')?.id).toBe(z.id);
  });
});

describe('dagReplay — revocation (§6.4)', () => {
  test('revoked node disappears from projection but stays in revokedIds set', () => {
    const target = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA' }, created_at: 1_700_000_000 });
    const revoke = stub({ parents: [target.id], action: 'revoked', payload: { revokes_id: target.id }, created_at: 1_700_000_005 });
    const p = replay([target, revoke]);
    expect(p.exchangeByPeerDid.has('did:key:zA')).toBe(false);
    expect(p.revokedIds.has(target.id)).toBe(true);
  });

  test('out-of-order revoke (arrives BEFORE its target) still applies', () => {
    const target = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA' }, created_at: 1_700_000_000 });
    const revoke = stub({ parents: [target.id], action: 'revoked', payload: { revokes_id: target.id }, created_at: 1_700_000_005 });
    const p = replay([revoke, target]);
    expect(p.exchangeByPeerDid.has('did:key:zA')).toBe(false);
  });

  test('revoke of one peer leaves other peers intact', () => {
    const a = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zA' }, created_at: 1_700_000_000 });
    const b = stub({ parents: [], action: 'exchange', payload: { peer_did: 'did:key:zB' }, created_at: 1_700_000_001 });
    const revokeA = stub({ parents: [a.id], action: 'revoked', payload: { revokes_id: a.id }, created_at: 1_700_000_005 });
    const p = replay([a, b, revokeA]);
    expect(p.exchangeByPeerDid.has('did:key:zA')).toBe(false);
    expect(p.exchangeByPeerDid.has('did:key:zB')).toBe(true);
  });
});

describe('dagReplay — action-specific projection keys', () => {
  test('attended → event_id', () => {
    const n = stub({ parents: [], action: 'attended', payload: { event_id: 'ev42' }, created_at: 1_700_000_000 });
    expect(replay([n]).attendedByEventId.has('ev42')).toBe(true);
  });

  test('presented → verifier_did|vc_id', () => {
    const n = stub({ parents: [], action: 'presented', payload: { verifier_did: 'did:key:zV', vc_id: 'vc1' }, created_at: 1_700_000_000 });
    expect(replay([n]).presentedByVerifierVc.has('did:key:zV|vc1')).toBe(true);
  });

  test('joined → group_id', () => {
    const n = stub({ parents: [], action: 'joined', payload: { group_id: 'g1' }, created_at: 1_700_000_000 });
    expect(replay([n]).joinedByGroupId.has('g1')).toBe(true);
  });

  test('dev.test action does not project to any map', () => {
    const n = stub({ parents: [], action: 'dev.test', payload: { note: 'x' }, created_at: 1_700_000_000 });
    const p = replay([n]);
    expect(p.exchangeByPeerDid.size).toBe(0);
    expect(p.attendedByEventId.size).toBe(0);
    expect(p.presentedByVerifierVc.size).toBe(0);
    expect(p.joinedByGroupId.size).toBe(0);
  });
});

describe('dagReplay — §13.3 perf gate', () => {
  test('10 000 nodes (+100 revocations sprinkled) replays in ≤ 50ms', () => {
    const nodes: DagNode[] = [];
    for (let i = 0; i < 10_000; i++) {
      nodes.push(stub({
        parents: [],
        action: 'exchange',
        payload: { peer_did: `did:key:z${String(i)}` },
        created_at: 1_700_000_000 + i,
      }));
    }
    // 100 revocations scattered every ~100 nodes
    for (let i = 0; i < 100; i++) {
      const target = nodes[i * 100];
      if (!target) continue;
      nodes.push(stub({
        parents: [target.id],
        action: 'revoked',
        payload: { revokes_id: target.id },
        created_at: 1_700_000_000 + 10_000 + i,
      }));
    }
    const t0 = performance.now();
    const p = replay(nodes);
    const elapsed = performance.now() - t0;
    expect(p.exchangeByPeerDid.size).toBe(10_000 - 100);
    expect(p.revokedIds.size).toBe(100);
    expect(elapsed).toBeLessThanOrEqual(50);
  });
});
