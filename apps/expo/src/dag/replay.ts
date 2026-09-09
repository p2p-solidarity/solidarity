/**
 * DAG replay — pure projection from the node list to a state snapshot.
 *
 * Spec: docs/ref/notes-dev-sandbox-identity-graph.md §6.3 (LWW conflict
 * resolution), §6.4 (revocation), §13.3 (full-replay rule + perf gate).
 *
 * Strategy: one pass to collect revoked-id set, then sort nodes by
 * `(created_at, id)` and apply LWW per the action-specific key. Cheap
 * enough that the 10 000-node / 50 ms perf gate (§13.3) holds — verified
 * in __tests__/unit/dagReplay.perf.test.ts.
 *
 * The reducer is intentionally fixed (not user-pluggable) so that two
 * devices replaying the same DAG always converge on the same state.
 * Adding a new `action` value means updating both this file and the
 * §6.3 table in the docs.
 */
import type { DagNode } from './node';

export interface DagProjection {
  /** key: peer_did */
  readonly exchangeByPeerDid: ReadonlyMap<string, DagNode>;
  /** key: event_id */
  readonly attendedByEventId: ReadonlyMap<string, DagNode>;
  /** key: verifier_did + '|' + vc_id */
  readonly presentedByVerifierVc: ReadonlyMap<string, DagNode>;
  /** key: group_id */
  readonly joinedByGroupId: ReadonlyMap<string, DagNode>;
  /** Every node id explicitly revoked via `action="revoked"`. */
  readonly revokedIds: ReadonlySet<string>;
}

/** Compute the full projection in one walk. */
export function replay(nodes: readonly DagNode[]): DagProjection {
  // Pass 1: gather revocations so application skips them, no second walk needed.
  const revoked = new Set<string>();
  for (const n of nodes) {
    if (n.action === 'revoked') {
      const target = n.payload['revokes_id'];
      if (typeof target === 'string') revoked.add(target);
    }
  }

  // Pass 2: deterministic order so LWW is independent of input order.
  const sorted = [...nodes].sort(byCreatedAtThenId);

  const exchangeByPeerDid = new Map<string, DagNode>();
  const attendedByEventId = new Map<string, DagNode>();
  const presentedByVerifierVc = new Map<string, DagNode>();
  const joinedByGroupId = new Map<string, DagNode>();

  for (const n of sorted) {
    if (revoked.has(n.id)) continue;
    switch (n.action) {
      case 'exchange': {
        const key = n.payload['peer_did'];
        if (typeof key === 'string') lwwSet(exchangeByPeerDid, key, n);
        break;
      }
      case 'attended': {
        const key = n.payload['event_id'];
        if (typeof key === 'string') lwwSet(attendedByEventId, key, n);
        break;
      }
      case 'presented': {
        const verifier = n.payload['verifier_did'];
        const vc = n.payload['vc_id'];
        if (typeof verifier === 'string' && typeof vc === 'string') {
          lwwSet(presentedByVerifierVc, verifier + '|' + vc, n);
        }
        break;
      }
      case 'joined': {
        const key = n.payload['group_id'];
        if (typeof key === 'string') lwwSet(joinedByGroupId, key, n);
        break;
      }
      // 'revoked' (already consumed) and 'dev.test' (debug-only) do not project.
      default:
        break;
    }
  }

  return {
    exchangeByPeerDid,
    attendedByEventId,
    presentedByVerifierVc,
    joinedByGroupId,
    revokedIds: revoked,
  };
}

function byCreatedAtThenId(a: DagNode, b: DagNode): number {
  if (a.created_at !== b.created_at) return a.created_at - b.created_at;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

function lwwSet(map: Map<string, DagNode>, key: string, candidate: DagNode): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }
  if (candidate.created_at > existing.created_at) {
    map.set(key, candidate);
    return;
  }
  if (candidate.created_at === existing.created_at && candidate.id > existing.id) {
    map.set(key, candidate);
  }
}
