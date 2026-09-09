/**
 * NIP-01 events — the ONE implementation of serialisation, id, BIP-340
 * signing and verification shared by the app (`nostr/userKey.ts`,
 * `dag/nostrAdapter.ts`) and the web builder (07-plan 階段 3). The wire is
 * NIP-01 verbatim: `id = sha256(JSON.stringify([0, pubkey, created_at, kind,
 * tags, content]))`, `sig = schnorr(id)` over secp256k1.
 *
 * The signing function takes the 32-byte scalar explicitly. Where that
 * scalar lives — the app's Keychain-backed store or the web's unlocked
 * session — is the caller's concern; nothing here persists or logs it.
 */
import { schnorr } from '@noble/curves/secp256k1.js';

import { utf8ToBytes } from '../crypto/base64';
import { sha256Bytes } from '../crypto/hash';
import { bytesToHex, hexToBytes } from '../crypto/hex';
import { err, ok, type Result } from '../types/result';

export interface NostrEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

/** A caller-assembled event, missing only `pubkey` / `id` / `sig`. */
export interface UnsignedNostrEvent {
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  /** Unix seconds. Defaults to "now" at signing time. */
  readonly created_at?: number;
}

export type Nip01UnsignedEvent = Omit<NostrEvent, 'id' | 'sig'>;

/** The exact NIP-01 serialisation the id commits to. */
export function serializeNip01Event(event: Nip01UnsignedEvent): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeNip01EventId(event: Nip01UnsignedEvent): string {
  return bytesToHex(sha256Bytes(utf8ToBytes(serializeNip01Event(event))));
}

/** The x-only (32-byte, hex) public key NIP-01 uses, from a secp256k1 scalar. */
export function nostrPublicKeyHex(scalar: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(scalar));
}

export function isNostrEvent(value: unknown): value is NostrEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<NostrEvent>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.pubkey === 'string' &&
    typeof candidate.created_at === 'number' &&
    typeof candidate.kind === 'number' &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => Array.isArray(tag) && tag.every((part) => typeof part === 'string')) &&
    typeof candidate.content === 'string' &&
    typeof candidate.sig === 'string'
  );
}

/**
 * Sign `unsigned` with a 32-byte secp256k1 scalar. Never throws — a scalar the
 * curve rejects (zero, ≥ n, wrong length) is reported as `err`. `nowSeconds`
 * is the fallback `created_at`, injectable for deterministic tests.
 */
export function signNostrEventWithScalar(
  unsigned: UnsignedNostrEvent,
  scalar: Uint8Array,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Result<NostrEvent, string> {
  let pubkey: string;
  try {
    pubkey = nostrPublicKeyHex(scalar);
  } catch (e) {
    return err(`nostr sign: ${e instanceof Error ? e.message : String(e)}`);
  }
  const event: Nip01UnsignedEvent = {
    pubkey,
    created_at: unsigned.created_at ?? nowSeconds,
    kind: unsigned.kind,
    tags: unsigned.tags,
    content: unsigned.content,
  };
  const id = computeNip01EventId(event);
  let sig: string;
  try {
    sig = bytesToHex(schnorr.sign(hexToBytes(id), scalar));
  } catch (e) {
    return err(`nostr sign: ${e instanceof Error ? e.message : String(e)}`);
  }
  return ok({ ...event, id, sig });
}

/** NIP-01 verification: the id must be the serialisation's hash AND the signature must verify under `pubkey`. */
export function verifyNostrEvent(event: NostrEvent): boolean {
  try {
    if (computeNip01EventId(event) !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}
