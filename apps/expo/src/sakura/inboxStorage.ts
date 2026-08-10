/**
 * Sakura inbox cache — local AES-GCM-wrapped store of decrypted messages.
 *
 * Mirrors Swift `SecureMessageStorage` (the per-sender + history files
 * sealed with `EncryptionManager`). On Expo we layer two encryption
 * envelopes:
 *   1. MMKV itself is opened with a master-key passphrase
 *      (see `src/storage/mmkv.ts`), so all on-disk pages are encrypted at
 *      rest by mmkv-libcommon.
 *   2. Each cache entry is additionally `encryptJson`-wrapped (Swift-
 *      compatible AES-256-GCM, nonce || ct || tag) before insertion. The
 *      double envelope guarantees a value extracted via filesystem snoop
 *      still requires the master key to recover.
 *
 * Why we store decrypted messages locally at all: matches Swift's
 * `MessageService.processIncomingMessages` flow — after the relay drops the
 * blob and we successfully open it, we surface plaintext in the inbox tab
 * (Shoutouts) without re-fetching. We also track ack status here so the
 * next `/v1/sync` cycle can ack messages the relay still believes are
 * unread (Swift mirror: `processedIds` list per cycle).
 */
import { decryptJson, encryptJson } from '@/storage/encryptionManager';
import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

const KEY_PREFIX = 'sakura:inbox:';

export interface CachedInboxMessage {
  /** Relay message id (matches `InboxMessage.id`). */
  readonly messageId: string;
  /** Plaintext payload, opened via `openInboxMessage`. */
  readonly decryptedJson: string;
  /** Unix epoch ms when we cached the entry. */
  readonly receivedAt: number;
  /** True once `/v1/ack` confirmed the relay dropped the message. */
  readonly acked: boolean;
}

function keyFor(id: string): string {
  return `${KEY_PREFIX}${id}`;
}

async function writeEntry(
  entry: CachedInboxMessage,
  operationEpoch: LocalDataEpoch,
): Promise<void> {
  try {
    const encrypted = await encryptJson(entry);
    if (!canCommitLocalData(operationEpoch)) return;
    getMmkv().set(keyFor(entry.messageId), encrypted);
  } catch {
    // MMKV unavailable — keep going so the rest of the sync isn't blocked.
  }
}

async function readEntry(id: string): Promise<CachedInboxMessage | null> {
  try {
    const raw = getMmkv().getString(keyFor(id));
    if (!raw) return null;
    return await decryptJson<CachedInboxMessage>(raw);
  } catch {
    return null;
  }
}

function listMessageIds(): readonly string[] {
  try {
    return getMmkv()
      .getAllKeys()
      .filter((k) => k.startsWith(KEY_PREFIX))
      .map((k) => k.slice(KEY_PREFIX.length));
  } catch {
    return [];
  }
}

/**
 * Insert or update a batch of cached messages. Idempotent: a re-upsert of
 * the same `messageId` overwrites previous fields (including `acked`).
 */
export async function upsert(
  msgs: readonly CachedInboxMessage[],
  operationEpoch: LocalDataEpoch,
): Promise<void> {
  for (const m of msgs) {
    await writeEntry(m, operationEpoch);
  }
}

/**
 * Mark a batch of message ids as acknowledged. Missing ids are silently
 * skipped — they may have been wiped between sync + ack.
 */
export async function markAcked(
  ids: readonly string[],
  operationEpoch: LocalDataEpoch,
): Promise<void> {
  for (const id of ids) {
    const existing = await readEntry(id);
    if (!existing) continue;
    await writeEntry({ ...existing, acked: true }, operationEpoch);
  }
}

/** Return ids of messages we've decrypted but not yet acked with the relay. */
export async function pendingAck(): Promise<readonly string[]> {
  const ids = listMessageIds();
  const out: string[] = [];
  for (const id of ids) {
    const entry = await readEntry(id);
    if (entry && !entry.acked) out.push(entry.messageId);
  }
  return out;
}

/**
 * Recent decrypted messages, newest first. Used by the Shoutouts UI to
 * paint a cached feed without waiting on the next relay sync.
 */
export async function recentMessages(
  limit = 50
): Promise<readonly CachedInboxMessage[]> {
  const ids = listMessageIds();
  const out: CachedInboxMessage[] = [];
  for (const id of ids) {
    const entry = await readEntry(id);
    if (entry) out.push(entry);
  }
  out.sort((a, b) => b.receivedAt - a.receivedAt);
  return out.slice(0, limit);
}

/** Test-only — wipe the entire cache. */
export function clearInboxCacheForTesting(): void {
  try {
    const mmkv = getMmkv();
    for (const k of mmkv.getAllKeys()) {
      if (k.startsWith(KEY_PREFIX)) mmkv.remove(k);
    }
  } catch {
    // No-op when MMKV isn't ready.
  }
}
