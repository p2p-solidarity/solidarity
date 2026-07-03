/**
 * DAG node schema, canonical id, schnorr sign / verify.
 *
 * Spec: docs/dev-sandbox-identity-graph.md §6.
 *
 * Canonical id follows NIP-01 exactly so the resulting `id` and `sig`
 * are bit-identical to what nostr-tools would produce for the same
 * inputs — that's the entire point of the bidirectional projection in
 * §6.2. A DAG node and its Nostr-event projection share id + sig.
 *
 * Schnorr is BIP-340 over secp256k1 (also what Nostr uses). The
 * sandbox dev-key (`src/dag/devKey.ts`) is the only producer.
 *
 * Determinism: `stableJSON` sorts object keys recursively before
 * stringification so payloads constructed in different key orders
 * still hash to the same id. Moved to `@solidarity/shared` (task A1.1)
 * so it can be shared with compact-JWS payload encoding; re-exported here
 * so existing imports of `stableJSON` from this module keep working.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { stableJSON } from '@solidarity/shared';

export { stableJSON };

export type DagPayload = Readonly<Record<string, unknown>>;

/** Action discriminators — see docs §6.3 for conflict resolution keys. */
export type DagAction =
  | 'exchange'
  | 'presented'
  | 'attended'
  | 'joined'
  | 'revoked'
  | 'dev.test'
  | string; // open-ended for future actions; conflict rule must be added per action

/** NIP-78 application-specific data — used for HEAD pointers (docs §6.2). */
export const KIND_DAG_HEAD = 30078;
/** NIP-94-adjacent immutable single-node kind (docs §6.2). */
export const KIND_DAG_NODE = 1063;
/** Sync-request broadcast kind (docs §6.2). */
export const KIND_DAG_SYNC = 1064;

export interface DagNodeUnsigned {
  /** Author's x-only secp256k1 pubkey, 64-char lowercase hex. */
  readonly author: string;
  /** 64-char hex ids of parent nodes. Empty array = root. */
  readonly parents: readonly string[];
  /** Nostr-compatible kind. Use `KIND_DAG_NODE` (1063) for individual nodes. */
  readonly kind: number;
  /** Action discriminator carried as the `["a","solidarity-action",…]` tag. */
  readonly action: DagAction;
  /** Action-specific payload. Keys order does not matter (canonicalized). */
  readonly payload: DagPayload;
  /** Unix seconds (Nostr convention, NOT milliseconds). */
  readonly created_at: number;
}

export interface DagNode extends DagNodeUnsigned {
  /** sha256 of the NIP-01 serialization, 64-char lowercase hex. */
  readonly id: string;
  /** schnorr BIP-340 signature over the id bytes, 128-char lowercase hex. */
  readonly sig: string;
}

/** Project a DagNode into the Nostr-event tags array (docs §6.2). */
export function nostrTagsFor(unsigned: DagNodeUnsigned): readonly (readonly string[])[] {
  const tags: (readonly string[])[] = [];
  for (const parent of unsigned.parents) {
    tags.push(['e', parent, '', 'reply']);
  }
  tags.push(['a', 'solidarity-action', unsigned.action]);
  return tags;
}

/** NIP-01 serialized form — the exact bytes that get sha256'd to produce the id. */
export function canonicalSerialization(unsigned: DagNodeUnsigned): string {
  const tags = nostrTagsFor(unsigned);
  // NIP-01: [0, pubkey, created_at, kind, tags, content]
  // content here is the stable-JSON of the payload, treated as an opaque string.
  return (
    '[0,' +
    JSON.stringify(unsigned.author) +
    ',' +
    String(unsigned.created_at) +
    ',' +
    String(unsigned.kind) +
    ',' +
    stableJSON(tags) +
    ',' +
    JSON.stringify(stableJSON(unsigned.payload)) +
    ']'
  );
}

/** Compute the canonical 32-byte id (hex) of an unsigned DAG node. */
export function computeNodeId(unsigned: DagNodeUnsigned): string {
  const bytes = new TextEncoder().encode(canonicalSerialization(unsigned));
  return hexEncode(sha256(bytes));
}

/**
 * Generic NIP-01 unsigned-event shape — `[0, pubkey, created_at, kind,
 * tags, content]`, the tuple every Nostr event id is a sha256 of. Unlike
 * `DagNodeUnsigned` (whose tags are derived from `parents`/`action` via
 * `nostrTagsFor`), this takes `tags`/`content` verbatim — the shape
 * needed to sign arbitrary Nostr events (NIP-78 profile pointers,
 * kind-0 metadata, …), not just DAG-node projections.
 */
export interface Nip01UnsignedEvent {
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
}

/**
 * Compute the canonical NIP-01 event id (hex) for an arbitrary Nostr
 * event. The ONE implementation of this serialization — `dag/nostrAdapter
 * .ts` (`buildHeadPointerEvent` / `verifyNostrEvent`) and `nostr/userKey
 * .ts` (`signNostrEvent`) all call this rather than each re-deriving the
 * `[0, pubkey, created_at, kind, tags, content]` tuple themselves.
 */
export function computeNip01EventId(event: Nip01UnsignedEvent): string {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return hexEncode(sha256(new TextEncoder().encode(serialized)));
}

/** Sign an unsigned DAG node with a 32-byte schnorr private key, returning a full node. */
export function signNode(unsigned: DagNodeUnsigned, privkey: Uint8Array): DagNode {
  if (privkey.length !== 32) {
    throw new RangeError(`schnorr privkey must be 32 bytes (got ${String(privkey.length)})`);
  }
  const id = computeNodeId(unsigned);
  const sig = schnorr.sign(hexDecode(id), privkey);
  return { ...unsigned, id, sig: hexEncode(sig) };
}

/**
 * Verify a DAG node: (a) the id matches the canonical recomputation
 * (catches tampered fields), (b) the schnorr signature is valid for
 * the author's x-only pubkey. Returns false on any malformed input.
 */
export function verifyNode(node: DagNode): boolean {
  try {
    const expected = computeNodeId(node);
    if (expected !== node.id) return false;
    return schnorr.verify(hexDecode(node.sig), hexDecode(node.id), hexDecode(node.author));
  } catch {
    return false;
  }
}

// ── Hex helpers ───────────────────────────────────────────────────────────

const HEX_TABLE: readonly string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, '0')
);

export function hexEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX_TABLE[bytes[i] ?? 0];
  return s;
}

export function hexDecode(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new RangeError(`hex must have even length (got ${String(hex.length)})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    if (!Number.isFinite(byte)) {
      throw new RangeError(`invalid hex at byte ${String(i)}: "${hex.substring(i * 2, i * 2 + 2)}"`);
    }
    out[i] = byte;
  }
  return out;
}
