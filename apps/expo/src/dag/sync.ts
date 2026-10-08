/**
 * DAG sync — three-step exchange over the BLE + WebRTC transport:
 *
 *   Step 1  HEADS exchange : each side sends its terminal-node set
 *   Step 2  WANT diff      : each side replies with ids it does NOT have
 *   Step 3  NODE stream    : each side answers WANT by streaming nodes
 *   Step 4  verify + merge : the receiver `appendNode`s, store rejects bad sigs
 *
 * Spec: docs/ref/notes-dev-sandbox-identity-graph.md §3.3 (sync protocol),
 * §5.1 (frame multiplex), §6.4 (revocations propagate like any node).
 *
 * This module is pure logic over the wire layer + store. The
 * transport itself (BLE L2CAP / WebRTC DataChannel) lives in
 * src/dag/webrtc.ts; this file is the portable protocol brain.
 *
 * Note on parent-walk: a single HEADS round can only ask for the
 * terminal ids the peer advertised. To reach common ancestors the
 * caller drives MULTIPLE rounds — each NODE the peer sends carries
 * `parents`, so after merging the receiver issues a new HEADS reflecting
 * the freshly inserted nodes, and the diff narrows. Sync converges in
 * O(diff depth) rounds. The driver decides when to stop (typically:
 * one round with zero NEW nodes inserted).
 */
import {
  type DagFrame,
  FRAME_KIND_HEADS,
  FRAME_KIND_NODE,
  FRAME_KIND_WANT,
  decodeHashList,
  decodeNodeBody,
  encodeDagFrame,
  encodeHashList,
  encodeNodeBody,
} from './wire';
import type { DagNode } from './node';
import type { DagStore } from './store';

/** Build the HEADS frame for outbound — the local store's current terminal set. */
export function buildHeadsFrame(store: DagStore): Uint8Array {
  return encodeDagFrame({ kind: FRAME_KIND_HEADS, body: encodeHashList(store.heads()) });
}

/**
 * Inspect a peer's HEADS, compute which ids the local store doesn't
 * have, and build the matching WANT frame.
 */
export function processHeadsAndBuildWant(
  store: DagStore,
  peerHeads: readonly string[]
): { readonly wantFrame: Uint8Array; readonly missingIds: readonly string[] } {
  const missing: string[] = [];
  for (const id of peerHeads) {
    if (!store.hasNode(id)) missing.push(id);
  }
  return {
    wantFrame: encodeDagFrame({ kind: FRAME_KIND_WANT, body: encodeHashList(missing) }),
    missingIds: missing,
  };
}

/**
 * Given a WANT list from the peer, produce one NODE frame per id we hold.
 * Skips silently for any id we don't have — the peer asked for something
 * we don't actually possess, which can happen if the WANT was computed
 * from a stale HEADS view.
 */
export function buildNodeFramesForWant(
  store: DagStore,
  wantedIds: readonly string[]
): readonly Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const id of wantedIds) {
    const node = store.getNode(id);
    if (node === null) continue;
    out.push(encodeDagFrame({ kind: FRAME_KIND_NODE, body: encodeNodeBody(JSON.stringify(node)) }));
  }
  return out;
}

export type NodeIngestResult =
  | { readonly kind: 'inserted'; readonly nodeId: string }
  | { readonly kind: 'duplicate'; readonly nodeId: string }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'parseError'; readonly reason: string };

/** Parse + verify + append a single NODE body. */
export function ingestNodeFrame(store: DagStore, nodeJson: string): NodeIngestResult {
  let node: DagNode;
  try {
    node = JSON.parse(nodeJson) as DagNode;
  } catch (err) {
    return { kind: 'parseError', reason: err instanceof Error ? err.message : 'JSON parse' };
  }
  if (!node || typeof node !== 'object' || typeof node.id !== 'string') {
    return { kind: 'parseError', reason: 'node payload missing id' };
  }
  const result = store.appendNode(node);
  if (result.kind === 'invalid') return { kind: 'invalid', reason: result.reason };
  if (result.kind === 'duplicate') return { kind: 'duplicate', nodeId: node.id };
  return { kind: 'inserted', nodeId: node.id };
}

export interface SyncStepResult {
  readonly outboundFrames: readonly Uint8Array[];
  readonly insertedNodeIds: readonly string[];
  readonly duplicateNodeIds: readonly string[];
  readonly errors: readonly string[];
}

/**
 * Drain a batch of incoming DAG frames and produce the outbound
 * response. The caller is responsible for actually pushing the bytes
 * over the transport.
 *
 * SDP / ICE frames are ignored here — they belong to the WebRTC layer
 * (src/dag/webrtc.ts) which subscribes separately on `kind === 0x13/0x14`.
 */
export function runSyncStep(
  store: DagStore,
  incomingFrames: readonly DagFrame[]
): SyncStepResult {
  const outbound: Uint8Array[] = [];
  const inserted: string[] = [];
  const duplicate: string[] = [];
  const errors: string[] = [];

  for (const f of incomingFrames) {
    if (f.kind === FRAME_KIND_HEADS) {
      const peerHeads = decodeHashList(f.body);
      const { wantFrame } = processHeadsAndBuildWant(store, peerHeads);
      outbound.push(wantFrame);
      continue;
    }
    if (f.kind === FRAME_KIND_WANT) {
      const wanted = decodeHashList(f.body);
      for (const frame of buildNodeFramesForWant(store, wanted)) outbound.push(frame);
      continue;
    }
    if (f.kind === FRAME_KIND_NODE) {
      const r = ingestNodeFrame(store, decodeNodeBody(f.body));
      if (r.kind === 'inserted') inserted.push(r.nodeId);
      else if (r.kind === 'duplicate') duplicate.push(r.nodeId);
      else if (r.kind === 'invalid') errors.push(`invalid node: ${r.reason}`);
      else errors.push(`parse error: ${r.reason}`);
      continue;
    }
    // SDP / ICE frames intentionally not handled — transport layer subscribes separately.
  }

  return {
    outboundFrames: outbound,
    insertedNodeIds: inserted,
    duplicateNodeIds: duplicate,
    errors,
  };
}
