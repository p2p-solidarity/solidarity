/**
 * DAG store — append-only persisted node + HEAD set tracking.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §3.2 (storage layout),
 * §6 (schema), §6.4 (revocation semantics — revocations are append-only
 * too; projections filter them out at replay time, see `replay.ts`).
 *
 * Architecture: `DagBackend` is an injectable key-value interface so
 * the pure TS test suite can use `InMemoryDagBackend` and the runtime
 * (when wired) plugs an MMKV-backed implementation that lives in a
 * separate file (intentionally NOT imported here so RN-free unit tests
 * stay RN-free).
 *
 * Storage layout in the backend:
 *   dag:v1:nodes:<64-char-hex-id>   →  JSON.stringify(DagNode)
 *   dag:v1:heads                    →  JSON.stringify(readonly string[])
 *
 * 4 KiB per-node cap mirrors §3.2 — payloads bigger than this should
 * ride SQLite when sync ships, not MMKV.
 */
import { computeNodeId, type DagNode, verifyNode } from './node';

export interface DagBackend {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  /** All keys; optionally filtered by prefix. Order is undefined. */
  keys(prefix?: string): readonly string[];
}

export class InMemoryDagBackend implements DagBackend {
  private readonly map = new Map<string, string>();

  get(key: string): string | undefined {
    return this.map.get(key);
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  keys(prefix?: string): readonly string[] {
    const all: string[] = [];
    for (const k of this.map.keys()) {
      if (prefix === undefined || k.startsWith(prefix)) all.push(k);
    }
    return all;
  }
}

const NODE_PREFIX = 'dag:v1:nodes:';
const HEADS_KEY = 'dag:v1:heads';
const MAX_NODE_BYTES = 4096;

export type DagAppendOutcome =
  | { readonly kind: 'inserted' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'invalid'; readonly reason: string };

export interface DagStore {
  /** Verify + persist a node, update HEAD set. Idempotent on duplicate id. */
  appendNode(node: DagNode): DagAppendOutcome;
  /** Fetch by id; null when not present or unparseable. */
  getNode(id: string): DagNode | null;
  /** True iff a node with this id is in the store. */
  hasNode(id: string): boolean;
  /** Snapshot of every persisted node (order undefined — caller must sort). */
  allNodes(): readonly DagNode[];
  /** Current terminal-node set. */
  heads(): readonly string[];
  /** Total node count. */
  count(): number;
  /** Wipe nodes + HEADs (Lab "Reset sandbox identity" + tests). */
  clear(): void;
}

export function createDagStore(backend: DagBackend): DagStore {
  function readHeads(): string[] {
    const raw = backend.get(HEADS_KEY);
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed as string[];
      }
    } catch {
      // corrupted heads index — fall through to empty, replay will rebuild
    }
    return [];
  }

  function writeHeads(heads: readonly string[]): void {
    backend.set(HEADS_KEY, JSON.stringify(heads));
  }

  function nodeKey(id: string): string {
    return NODE_PREFIX + id;
  }

  function parseNode(raw: string): DagNode | null {
    try {
      return JSON.parse(raw) as DagNode;
    } catch {
      return null;
    }
  }

  return {
    appendNode(node) {
      if (typeof node.id !== 'string' || node.id.length !== 64) {
        return { kind: 'invalid', reason: 'id must be 64-char lowercase hex' };
      }
      if (backend.get(nodeKey(node.id)) !== undefined) {
        return { kind: 'duplicate' };
      }
      if (computeNodeId(node) !== node.id) {
        return { kind: 'invalid', reason: 'id does not match canonical recomputation' };
      }
      if (!verifyNode(node)) {
        return { kind: 'invalid', reason: 'schnorr signature invalid' };
      }
      const json = JSON.stringify(node);
      if (json.length > MAX_NODE_BYTES) {
        return {
          kind: 'invalid',
          reason: `node exceeds ${String(MAX_NODE_BYTES)}-byte cap (${String(json.length)} bytes)`,
        };
      }
      backend.set(nodeKey(node.id), json);
      const heads = new Set(readHeads());
      for (const p of node.parents) heads.delete(p);
      heads.add(node.id);
      writeHeads(Array.from(heads));
      return { kind: 'inserted' };
    },

    getNode(id) {
      const raw = backend.get(nodeKey(id));
      if (raw === undefined) return null;
      return parseNode(raw);
    },

    hasNode(id) {
      return backend.get(nodeKey(id)) !== undefined;
    },

    allNodes() {
      const out: DagNode[] = [];
      for (const k of backend.keys(NODE_PREFIX)) {
        const raw = backend.get(k);
        if (raw === undefined) continue;
        const node = parseNode(raw);
        if (node) out.push(node);
      }
      return out;
    },

    heads() {
      return readHeads();
    },

    count() {
      return backend.keys(NODE_PREFIX).length;
    },

    clear() {
      for (const k of backend.keys(NODE_PREFIX)) backend.delete(k);
      backend.delete(HEADS_KEY);
    },
  };
}
