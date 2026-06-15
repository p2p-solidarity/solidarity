/**
 * Shard distribution — splits the vault root secret with Shamir + ships
 * each share via Sakura to a trusted contact. Mirrors
 * solidarity/Services/Vault/ShardDistributionService.swift.
 *
 * Flow:
 *   1. Load the root secret (biometric-gated).
 *   2. `split(rootSecret, threshold, recipients.length)` from @solidarity/shared.
 *   3. For each recipient: `wrapShard(...)` then post a Sakura message of
 *      type `vault.shard.v1`.
 *   4. Persist a local distribution record (which contact got which index,
 *      when) under MMKV so the UI can list "guardians" + show acknowledge
 *      status later.
 *
 * Revoke: best-effort — we send a `vault.shard.revoke.v1` message and drop
 * the local record. The shard remains physically with the guardian, same as
 * the Swift trust model (we don't attempt remote deletion).
 *
 * Indirection through `sakuraClient` so tests can inject a stub.
 */
import {
  base64Encode,
  split,
  utf8ToBytes,
  uuid,
  type SendRequest,
} from '@solidarity/shared';

import { getMmkv } from '@/storage/mmkv';
import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import {
  buildSealedSendRequest,
  sendMessage as sakuraSendMessage,
} from '@/sakura/client';

import {
  getOrCreateRootSecret,
  type RootSecretResult,
} from './secretsKeychain';
import {
  encodeEnvelope,
  wrapShard,
  type WrappedShardEnvelope,
} from './shardEnvelope';

export const VAULT_SHARD_MESSAGE_TYPE = 'vault.shard.v1';
export const VAULT_SHARD_REVOKE_MESSAGE_TYPE = 'vault.shard.revoke.v1';

const DISTRIBUTION_PREFIX = 'vault.dist:';

export interface ShardRecipient {
  readonly contactId: string;
  /** Recipient's long-term X25519 pubkey (base64). */
  readonly sakuraRecipientPub: string;
  /** Recipient's pre-issued sealed route (from a prior `sealToken` exchange). */
  readonly sakuraSealedRoute: string;
  /** Our P-256 ECDSA signing pubkey (passed through to SendRequest). */
  readonly senderSignPubKey: string;
  /** Optional display name — only used for the local distribution record. */
  readonly displayName?: string;
}

export interface DistributionArgs {
  readonly vaultId: string;
  readonly threshold: number;
  readonly recipients: readonly ShardRecipient[];
  /**
   * Optional override for the network send. Production callers leave this
   * undefined; tests inject a stub to capture envelopes without hitting
   * the relay.
   */
  readonly sendOverride?: (req: SendRequest) => Promise<void>;
}

export interface DistributionRecord {
  readonly vaultId: string;
  readonly contactId: string;
  readonly displayName?: string;
  readonly shardIndex: number;
  readonly threshold: number;
  readonly total: number;
  readonly distributedAt: string;
  readonly messageType: typeof VAULT_SHARD_MESSAGE_TYPE;
  readonly revoked: boolean;
}

export type DistributionResult =
  | {
      readonly kind: 'ok';
      readonly records: readonly DistributionRecord[];
      readonly envelopes: readonly WrappedShardEnvelope[];
    }
  | {
      readonly kind: 'err';
      readonly reason:
        | 'biometricDenied'
        | 'storageFailed'
        | 'invalidThreshold'
        | 'wrapFailed'
        | 'sendFailed';
    };

function recordKey(vaultId: string, contactId: string): string {
  // Normalise casing so callers using either lowercase or uppercase UUIDs
  // hit the same MMKV row — matches the case-normalisation in
  // `wrapShard` which uppercases the envelope vault id.
  return `${DISTRIBUTION_PREFIX}${vaultId.toUpperCase()}:${contactId.toUpperCase()}`;
}

async function persistRecord(rec: DistributionRecord): Promise<void> {
  getMmkv().set(recordKey(rec.vaultId, rec.contactId), await encryptJson(rec));
}

async function loadRecord(
  vaultId: string,
  contactId: string
): Promise<DistributionRecord | null> {
  const raw = getMmkv().getString(recordKey(vaultId, contactId));
  return raw ? await decryptJson<DistributionRecord>(raw) : null;
}

/** Best-effort: every record currently stored locally. */
export async function loadAllDistributionRecords(): Promise<
  readonly DistributionRecord[]
> {
  const out: DistributionRecord[] = [];
  for (const k of getMmkv().getAllKeys()) {
    if (!k.startsWith(DISTRIBUTION_PREFIX)) continue;
    const raw = getMmkv().getString(k);
    if (!raw) continue;
    try {
      out.push(await decryptJson<DistributionRecord>(raw));
    } catch {
      // Skip records that no longer decrypt cleanly (master-key rotated).
    }
  }
  return out;
}

interface ShardMessagePayload {
  readonly type: typeof VAULT_SHARD_MESSAGE_TYPE;
  readonly envelopeJson: string;
  /** Total recipient count (informational; threshold lives inside envelope). */
  readonly total: number;
  readonly distributedAt: string;
}

async function sendShard(
  recipient: ShardRecipient,
  envelope: WrappedShardEnvelope,
  total: number,
  distributedAt: string,
  override?: (req: SendRequest) => Promise<void>
): Promise<void> {
  const payload: ShardMessagePayload = {
    type: VAULT_SHARD_MESSAGE_TYPE,
    envelopeJson: encodeEnvelope(envelope),
    total,
    distributedAt,
  };
  const req = buildSealedSendRequest({
    recipientPubKey: recipient.sakuraRecipientPub,
    recipientSealedRoute: recipient.sakuraSealedRoute,
    senderSignPubKey: recipient.senderSignPubKey,
    payload,
  });
  if (override) {
    await override(req);
    return;
  }
  await sakuraSendMessage(req);
}

/**
 * Split + wrap + ship. Returns the per-recipient envelopes so the caller
 * can persist them (or display QR codes) in addition to the Sakura send.
 */
export async function distributeRecoveryShards(
  args: DistributionArgs
): Promise<DistributionResult> {
  const { vaultId, threshold, recipients } = args;
  if (threshold < 2 || recipients.length < threshold || recipients.length > 255) {
    return { kind: 'err', reason: 'invalidThreshold' };
  }

  const root: RootSecretResult = await getOrCreateRootSecret('biometric');
  if (root.kind === 'err') {
    return { kind: 'err', reason: root.reason };
  }

  const shares = split(root.bytes, threshold, recipients.length);
  const distributedAt = new Date().toISOString();
  const envelopes: WrappedShardEnvelope[] = [];
  const records: DistributionRecord[] = [];

  for (let i = 0; i < recipients.length; i += 1) {
    const recipient = recipients[i];
    const share = shares[i];
    if (!recipient || !share) {
      return { kind: 'err', reason: 'wrapFailed' };
    }
    // Serialise the Shamir share as [index : 1 byte] || [y bytes] to match
    // the byte layout of `solidarity/Services/Vault/ShamirSecretSharing.swift`
    // when sealed. Recovery splits it back out before calling `combine`.
    const shardBytes = new Uint8Array(1 + share.y.length);
    shardBytes[0] = share.index;
    shardBytes.set(share.y, 1);

    const wrapped = wrapShard(shardBytes, root.bytes, {
      vaultId,
      guardianContactId: recipient.contactId,
      shardIndex: share.index,
      threshold,
    });
    if (wrapped.kind === 'err') {
      return { kind: 'err', reason: 'wrapFailed' };
    }
    envelopes.push(wrapped.envelope);

    try {
      await sendShard(
        recipient,
        wrapped.envelope,
        recipients.length,
        distributedAt,
        args.sendOverride
      );
    } catch {
      return { kind: 'err', reason: 'sendFailed' };
    }

    const record: DistributionRecord = {
      vaultId,
      contactId: recipient.contactId,
      displayName: recipient.displayName,
      shardIndex: share.index,
      threshold,
      total: recipients.length,
      distributedAt,
      messageType: VAULT_SHARD_MESSAGE_TYPE,
      revoked: false,
    };
    try {
      await persistRecord(record);
    } catch {
      return { kind: 'err', reason: 'storageFailed' };
    }
    records.push(record);
  }

  return { kind: 'ok', records, envelopes };
}

/** Re-emit `VAULT_SHARD_REVOKE_MESSAGE_TYPE` to the guardian + clear local. */
export interface RevokeArgs {
  readonly vaultId: string;
  readonly contactId: string;
  readonly recipient?: ShardRecipient;
  readonly sendOverride?: (req: SendRequest) => Promise<void>;
}

export type RevokeResult =
  | { readonly kind: 'ok' }
  | { readonly kind: 'err'; readonly reason: 'notFound' | 'sendFailed' };

export async function revokeShard(args: RevokeArgs): Promise<RevokeResult> {
  const { vaultId, contactId, recipient } = args;
  const existing = await loadRecord(vaultId, contactId);
  if (!existing) return { kind: 'err', reason: 'notFound' };

  if (recipient) {
    const payload = {
      type: VAULT_SHARD_REVOKE_MESSAGE_TYPE,
      vaultId,
      shardIndex: existing.shardIndex,
      revokedAt: new Date().toISOString(),
    };
    try {
      const req = buildSealedSendRequest({
        recipientPubKey: recipient.sakuraRecipientPub,
        recipientSealedRoute: recipient.sakuraSealedRoute,
        senderSignPubKey: recipient.senderSignPubKey,
        payload,
      });
      if (args.sendOverride) {
        await args.sendOverride(req);
      } else {
        await sakuraSendMessage(req);
      }
    } catch {
      return { kind: 'err', reason: 'sendFailed' };
    }
  }

  const updated: DistributionRecord = { ...existing, revoked: true };
  await persistRecord(updated);
  return { kind: 'ok' };
}

/**
 * Helpers used by the recovery side: extract the embedded Shamir index +
 * y-bytes from the per-shard plaintext layout we sealed in
 * `distributeRecoveryShards`.
 */
export function parseShardPayloadBytes(
  bytes: Uint8Array
): { readonly index: number; readonly y: Uint8Array } | null {
  if (bytes.length < 2) return null;
  return { index: bytes[0] ?? 0, y: bytes.subarray(1) };
}

/** Test-only — generate a deterministic dummy SendRequest payload b64. */
export function _testEncodeShardMessage(payload: ShardMessagePayload): string {
  return base64Encode(utf8ToBytes(JSON.stringify(payload)));
}

/** Generate a new message id usable as the Sakura inbox id (test helper). */
export function _testNewMessageId(): string {
  return uuid();
}
