/**
 * Shoutout manifest — minimal non-sensitive fields the list / stats / detail
 * header views need on frame 1. Stored plaintext (MMKV-encrypted, not per-
 * record AES) so cold launch can render the counterpart strip and per-
 * counterpart message counts without decrypting each Sakura payload.
 *
 * Full Shoutout (subject + body — the 200-byte end-to-end encrypted
 * payload) stays in the encrypted `shoutout:{id}` MMKV keys and is
 * decrypted lazily on detail open or via `hydrate()` in the background.
 *
 * NOTE on field selection (deviation from the agent task template):
 *   The task template lists Contact-shaped fields (name/title/company/
 *   verificationStatus) because the parallel rollout uses one prompt for
 *   six stores. Shoutouts are *messages*, not wrapped contacts —
 *   shape is `{id, direction, counterpartName, subject, body, createdAt}`
 *   (see `./store.ts`). We honour the rule "non-sensitive list fields
 *   only, message bodies stay encrypted" and adapt the entry shape to
 *   the actual Shoutout record.
 *
 * Safe to include:
 *   - id              — opaque UUID
 *   - direction       — 'incoming' | 'outgoing' (UI badge, no PII beyond
 *                       the counterpart's existence)
 *   - counterpartName — already displayed on the gallery / detail header
 *                       (same string lives in the Contact manifest under
 *                       a different scope; nothing new is leaked)
 *   - lastInteractionAt — ISO string (Date is serialised so the manifest
 *                         JSON round-trips losslessly; consumers parse it
 *                         back to Date when they need ordering)
 *
 * Excluded (kept encrypted in `shoutout:{id}`):
 *   - body            — the e2ee payload, the entire reason the record
 *                       is encrypted
 *   - subject         — sliced from body (`message.slice(0, 64)` in
 *                       `app/shoutouts/new.tsx`) so including it would
 *                       leak the leading 64 chars of the ciphertext
 *                       plaintext
 *   - any future fields: notes, tags, sealedRoute, pubKey, signPubKey,
 *                        didPublicKey, signatures, myEphemeralMessage,
 *                        theirEphemeralMessage, raw message bodies
 *
 * Consumers that need `subject` or `body` (chart `aggregateByTopic`,
 * `<MessageBullet>` in the detail history list) must hydrate the
 * details map first.
 */
import type { Shoutout, ShoutoutDirection } from './store';

export interface ShoutoutManifestEntry {
  readonly id: string;
  readonly direction: ShoutoutDirection;
  readonly counterpartName: string;
  /** ISO 8601 — JSON-stable replacement for `createdAt: Date`. */
  readonly lastInteractionAt: string;
}

export function toShoutoutManifest(item: Shoutout): ShoutoutManifestEntry {
  return {
    id: item.id,
    direction: item.direction,
    counterpartName: item.counterpartName,
    lastInteractionAt: item.createdAt.toISOString(),
  };
}

export const SHOUTOUTS_MANIFEST_SCOPE = 'shoutouts:v1';
