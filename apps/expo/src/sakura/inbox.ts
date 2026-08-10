/**
 * Sakura inbox orchestrator — pull → decrypt → cache → ack loop.
 *
 * Mirrors Swift `MessageService.processIncomingMessages`:
 *   1. Pull inbox blobs via `/v1/inbox?pubkey=<encryptionPub>`.
 *   2. Decrypt each `sealed_blob` with the holder's long-term X25519 priv
 *      (`openBlob` from `@solidarity/shared`).
 *   3. Upsert the plaintext into the local AES-GCM-wrapped cache so the UI
 *      can paint without waiting on the next relay round trip.
 *   4. Ack the relay so the same blob isn't redelivered on the next sync.
 *
 * Foreground polling is opt-in via `startForegroundPolling`; the iOS Swift
 * AppDelegate already wakes us in the background through silent pushes
 * (UIBackgroundModes: remote-notification), so polling is mainly a
 * simulator + foreground-bridge fallback (parity with Swift `startPolling`
 * which it also gates with NotificationSettingsManager.enableAutoSync).
 */
import {
  base64Decode,
  base64Encode,
  bytesToUtf8,
  openBlob,
  utf8ToBytes,
  type InboxMessage,
} from '@solidarity/shared';
import { ed25519 } from '@noble/curves/ed25519.js';

import {
  canCommitLocalData,
  captureLocalDataEpoch,
  type LocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

import { ackMessages, syncInbox } from './client';
import {
  pendingAck,
  recentMessages,
  upsert,
  markAcked,
  type CachedInboxMessage,
} from './inboxStorage';
import {
  __getRecipientSecretsForInbox,
  loadOrCreateRecipientKeys,
} from './recipientKeys';

export interface DecryptedMessage {
  readonly messageId: string;
  readonly senderPubkey: string;
  readonly receivedAt: number;
  /** Plaintext payload after `openBlob` (UTF-8 JSON string). */
  readonly text: string;
}

interface RecipientSecrets {
  readonly encPriv: Uint8Array;
  readonly sigPriv: Uint8Array;
  readonly encryptionPubBase64: string;
  readonly signingPubBase64: string;
}

async function withSecrets<T>(
  fn: (secrets: RecipientSecrets) => Promise<T>
): Promise<T> {
  const pair = await loadOrCreateRecipientKeys();
  const priv = __getRecipientSecretsForInbox();
  if (!priv) {
    throw new Error('recipientKeys: secrets not loaded');
  }
  return fn({
    encPriv: priv.encPriv,
    sigPriv: priv.sigPriv,
    encryptionPubBase64: pair.encryptionPubBase64,
    signingPubBase64: pair.signingPubBase64,
  });
}

function decryptOne(
  msg: InboxMessage,
  encPriv: Uint8Array
): DecryptedMessage | null {
  try {
    const blob = base64Decode(msg.blob);
    const plaintext = openBlob(encPriv, blob);
    return {
      messageId: msg.id,
      senderPubkey: msg.owner_pubkey,
      receivedAt: Date.now(),
      text: bytesToUtf8(plaintext),
    };
  } catch {
    // A blob we can't open is either malformed or addressed to a stale key
    // — same outcome as Swift's `decrypt` throw path: skip + leave on relay
    // so a future key rotation can retry.
    return null;
  }
}

function signAckPayload(ids: readonly string[], sigPriv: Uint8Array): string {
  // Matches Swift `MessageService.ackMessages` (line 132):
  //   ids.joined(separator: ",") → SecureKeyManager.sign(content:) →
  //   Curve25519.Signing.PrivateKey.signature(for: utf8).base64EncodedString().
  // Ed25519 signs the raw UTF-8 bytes directly — no SHA-256 prehash.
  const canonical = ids.join(',');
  return base64Encode(ed25519.sign(utf8ToBytes(canonical), sigPriv));
}

async function ackBatch(
  ids: readonly string[],
  secrets: RecipientSecrets,
  operationEpoch: LocalDataEpoch,
): Promise<void> {
  if (ids.length === 0) return;
  if (!canCommitLocalData(operationEpoch)) return;
  await ackMessages({
    message_ids: [...ids],
    pubkey: secrets.signingPubBase64,
    sig: signAckPayload(ids, secrets.sigPriv),
  });
  if (!canCommitLocalData(operationEpoch)) return;
  await markAcked(ids, operationEpoch);
}

/**
 * Pull, decrypt, cache, and ack one inbox batch. Returns the messages that
 * were newly opened on this call (already-cached entries are skipped).
 *
 * On any per-message decrypt failure we still ack the others so the relay
 * doesn't redeliver them indefinitely.
 */
export async function syncOnce(): Promise<readonly DecryptedMessage[]> {
  const operationEpoch = captureLocalDataEpoch();
  if (!canCommitLocalData(operationEpoch)) return [];
  return withSecrets(async (secrets) => {
    if (!canCommitLocalData(operationEpoch)) return [];
    const messages = await syncInbox(secrets.encryptionPubBase64);
    if (!canCommitLocalData(operationEpoch)) return [];
    if (messages.length === 0) {
      // Even with zero new mail there may be leftover ack debt from a prior
      // run that died after upsert but before ack — flush it now.
      const debt = await pendingAck();
      await ackBatch(debt, secrets, operationEpoch);
      return [];
    }

    const decrypted: DecryptedMessage[] = [];
    const cacheEntries: CachedInboxMessage[] = [];
    const ackIds: string[] = [];
    for (const m of messages) {
      const opened = decryptOne(m, secrets.encPriv);
      if (!opened) continue;
      decrypted.push(opened);
      cacheEntries.push({
        messageId: opened.messageId,
        decryptedJson: opened.text,
        receivedAt: opened.receivedAt,
        acked: false,
      });
      ackIds.push(opened.messageId);
    }

    await upsert(cacheEntries, operationEpoch);
    if (!canCommitLocalData(operationEpoch)) return [];
    await ackBatch(ackIds, secrets, operationEpoch);
    if (!canCommitLocalData(operationEpoch)) return [];
    return decrypted;
  });
}

// ─── Foreground polling ─────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start a foreground polling loop. Matches Swift `MessageService.startPolling`
 * — primarily a simulator / foreground fallback when silent push isn't an
 * option. Default interval mirrors `NotificationSettingsManager.syncIntervalSeconds`.
 */
export function startForegroundPolling(intervalMs = 30_000): void {
  stopForegroundPolling();
  pollTimer = setInterval(() => {
    void syncOnce().catch(() => {
      // Swift silences polling errors to avoid log spam — same here.
    });
  }, intervalMs);
}

export function stopForegroundPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Cached read-through for the UI; no network. */
export async function cachedInbox(limit?: number): Promise<readonly CachedInboxMessage[]> {
  return recentMessages(limit);
}
