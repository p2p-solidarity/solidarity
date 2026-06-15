/**
 * Wrapped shard envelope — mirrors solidarity/Services/Vault/
 * WrappedShardEnvelope.swift.
 *
 * Each Shamir share is sealed with AES-256-GCM using a per-vault wrap key
 * (the vault root secret). The vault id, guardian contact id, shard index,
 * and schema version are bound into the AAD so:
 *   - A forged envelope with attacker-chosen metadata fails the auth tag
 *     (re-binding the AAD changes the GCM tag).
 *   - Recovery code can read those fields off the envelope without trusting
 *     them naïvely: any deviation from the bytes that were AAD'd at seal
 *     time triggers an AES-GCM open failure.
 *
 * Wire format (Codable JSON, base64-encoded ciphertext, must match Swift
 * exactly so iOS and the TS port can interop on the same shard envelopes):
 *
 *   {
 *     "schemaVersion": 1,
 *     "vaultId":            "<uppercased UUID string>",
 *     "guardianContactId":  "<uppercased UUID string>",
 *     "shardIndex":         <Int>,
 *     "threshold":          <Int>,
 *     "ciphertext":         "<base64 of nonce(12)||ct||tag(16)>"
 *   }
 *
 * Swift's `Data` JSON Codable serialises as base64; UUIDs default to the
 * 8-4-4-4-12 uppercase string with `JSONEncoder`. We match both here.
 *
 * AAD layout (mirrors Swift `makeAAD`, byte-equal):
 *   uuid_bytes(vaultId, 16)
 *   || uuid_bytes(guardianContactId, 16)
 *   || int64_le(shardIndex, 8)
 *   || u8(schemaVersion)
 *
 * Total AAD length = 16 + 16 + 8 + 1 = 41 bytes.
 *
 * NB: noble's AES-GCM helper in `@solidarity/shared/crypto/aesGcm` does
 * NOT accept AAD; we drop directly to `@noble/ciphers/aes` here so we can
 * pass the AAD argument. Output layout is identical to `aesGcmSeal` —
 * nonce(12) || ciphertext || tag(16).
 */
import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { base64Decode, base64Encode } from '@solidarity/shared';

const SCHEMA_VERSION = 1;
const NONCE_LEN = 12;
const TAG_LEN = 16;
const UUID_BYTES = 16;
const INDEX_BYTES = 8;
const VERSION_BYTES = 1;
const AAD_LEN = UUID_BYTES + UUID_BYTES + INDEX_BYTES + VERSION_BYTES;

/** Discriminated-union surface for callers (no `throw` on bad input). */
export type WrapResult =
  | { readonly kind: 'ok'; readonly envelope: WrappedShardEnvelope }
  | { readonly kind: 'err'; readonly reason: 'sealFailed' | 'invalidParams' };

export type UnwrapResult =
  | { readonly kind: 'ok'; readonly shardBytes: Uint8Array }
  | {
      readonly kind: 'err';
      readonly reason: 'decodeFailed' | 'authFailed' | 'bindingMismatch';
    };

/** JSON-serialisable Codable mirror of Swift WrappedShardEnvelope. */
export interface WrappedShardEnvelope {
  readonly schemaVersion: number;
  readonly vaultId: string;
  readonly guardianContactId: string;
  readonly shardIndex: number;
  readonly threshold: number;
  readonly ciphertext: string;
}

export interface WrapMetadata {
  readonly vaultId: string;
  readonly guardianContactId: string;
  readonly shardIndex: number;
  readonly threshold: number;
}

/**
 * Parse a UUID string (with or without dashes, case-insensitive) into its
 * 16 raw bytes. Mirrors Swift's `uuid_t` memory layout (8 fields, big-endian
 * within each component; the canonical string form preserves byte order
 * left-to-right, so a plain hex parse is correct).
 */
export function uuidStringToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/gu, '').toLowerCase();
  if (hex.length !== UUID_BYTES * 2) {
    throw new Error(`invalid uuid: ${uuid}`);
  }
  const out = new Uint8Array(UUID_BYTES);
  for (let i = 0; i < UUID_BYTES; i += 1) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid uuid byte at ${String(i)}`);
    out[i] = byte;
  }
  return out;
}

function makeAad(meta: WrapMetadata): Uint8Array {
  const aad = new Uint8Array(AAD_LEN);
  aad.set(uuidStringToBytes(meta.vaultId), 0);
  aad.set(uuidStringToBytes(meta.guardianContactId), UUID_BYTES);

  // Swift uses Int64 little-endian for shardIndex. JavaScript Number safely
  // holds integers up to 2^53; shard indexes are small (1..255) so the upper
  // 4 bytes are always zero, but we still write 8 to match the byte layout.
  const view = new DataView(aad.buffer, UUID_BYTES + UUID_BYTES, INDEX_BYTES);
  view.setBigInt64(0, BigInt(meta.shardIndex), /* littleEndian */ true);

  aad[AAD_LEN - 1] = SCHEMA_VERSION;
  return aad;
}

/** Seal a Shamir share with the wrap key + metadata-bound AAD. */
export function wrapShard(
  shardBytes: Uint8Array,
  wrapKey: Uint8Array,
  meta: WrapMetadata
): WrapResult {
  if (wrapKey.length !== 32) {
    return { kind: 'err', reason: 'invalidParams' };
  }
  if (meta.threshold < 2 || meta.shardIndex < 1) {
    return { kind: 'err', reason: 'invalidParams' };
  }

  try {
    const aad = makeAad(meta);
    const nonce = randomBytes(NONCE_LEN);
    const ctTag = gcm(wrapKey, nonce, aad).encrypt(shardBytes);
    const combined = new Uint8Array(NONCE_LEN + ctTag.length);
    combined.set(nonce, 0);
    combined.set(ctTag, NONCE_LEN);
    return {
      kind: 'ok',
      envelope: {
        schemaVersion: SCHEMA_VERSION,
        vaultId: meta.vaultId.toUpperCase(),
        guardianContactId: meta.guardianContactId.toUpperCase(),
        shardIndex: meta.shardIndex,
        threshold: meta.threshold,
        ciphertext: base64Encode(combined),
      },
    };
  } catch {
    return { kind: 'err', reason: 'sealFailed' };
  }
}

/**
 * Open an envelope, trusting the metadata read off it. The auth tag still
 * binds those fields — a forged envelope with attacker-chosen values fails
 * to open. The caller MAY assert the expected threshold (defence-in-depth).
 */
export function unwrapShard(
  envelope: WrappedShardEnvelope,
  wrapKey: Uint8Array,
  expectedThreshold?: number
): UnwrapResult {
  if (wrapKey.length !== 32) {
    return { kind: 'err', reason: 'bindingMismatch' };
  }
  if (envelope.schemaVersion !== SCHEMA_VERSION) {
    return { kind: 'err', reason: 'bindingMismatch' };
  }
  if (
    expectedThreshold !== undefined &&
    envelope.threshold !== expectedThreshold
  ) {
    return { kind: 'err', reason: 'bindingMismatch' };
  }

  let combined: Uint8Array;
  try {
    combined = base64Decode(envelope.ciphertext);
  } catch {
    return { kind: 'err', reason: 'decodeFailed' };
  }
  if (combined.length < NONCE_LEN + TAG_LEN) {
    return { kind: 'err', reason: 'decodeFailed' };
  }

  try {
    const aad = makeAad(envelope);
    const nonce = combined.subarray(0, NONCE_LEN);
    const ctTag = combined.subarray(NONCE_LEN);
    const plain = gcm(wrapKey, nonce, aad).decrypt(ctTag);
    return { kind: 'ok', shardBytes: plain };
  } catch {
    return { kind: 'err', reason: 'authFailed' };
  }
}

/** JSON encode (Swift Data is base64'd, dates not relevant here). */
export function encodeEnvelope(envelope: WrappedShardEnvelope): string {
  return JSON.stringify(envelope);
}

/** Parse a JSON envelope. Returns `null` on any structural error. */
export function decodeEnvelope(json: string): WrappedShardEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('schemaVersion' in parsed) ||
    !('vaultId' in parsed) ||
    !('guardianContactId' in parsed) ||
    !('shardIndex' in parsed) ||
    !('threshold' in parsed) ||
    !('ciphertext' in parsed)
  ) {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (
    typeof obj['schemaVersion'] !== 'number' ||
    typeof obj['vaultId'] !== 'string' ||
    typeof obj['guardianContactId'] !== 'string' ||
    typeof obj['shardIndex'] !== 'number' ||
    typeof obj['threshold'] !== 'number' ||
    typeof obj['ciphertext'] !== 'string'
  ) {
    return null;
  }
  return {
    schemaVersion: obj['schemaVersion'],
    vaultId: obj['vaultId'],
    guardianContactId: obj['guardianContactId'],
    shardIndex: obj['shardIndex'],
    threshold: obj['threshold'],
    ciphertext: obj['ciphertext'],
  };
}
