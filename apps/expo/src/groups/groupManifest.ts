/**
 * Group manifest — minimal non-sensitive fields the list views need on
 * frame 1. Stored plaintext (MMKV-encrypted, not per-record AES) so cold
 * launch can render the group picker / settings list without N decrypts.
 *
 * Full GroupModel (ownerRecordID, merkleRoot, credentialIssuers, ZK / proof
 * material) stays in the encrypted `group:{id}` keys and is decrypted
 * lazily on detail open or via `hydrate()` in the background.
 *
 * Safe to include:
 *   - id          — opaque UUID
 *   - name        — already displayed on every list
 *   - description — short blurb, already in the management card
 *   - memberCount — already in the management card
 *   - isPrivate   — drives the lock badge on the list card
 *
 * Excluded (kept encrypted, never in the manifest):
 *   - ownerRecordID, merkleRoot, merkleTreeDepth, credentialIssuers,
 *     isSynced (sync state can't be inferred from manifest alone),
 *     and any ZK / proof / policy material.
 */
import type { GroupModel } from './store';

export interface GroupManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly memberCount?: number;
  readonly isPrivate?: boolean;
}

export function toGroupManifest(group: GroupModel): GroupManifestEntry {
  return {
    id: group.id,
    name: group.name,
    ...(group.description.length > 0 ? { description: group.description } : {}),
    ...(typeof group.memberCount === 'number' ? { memberCount: group.memberCount } : {}),
    ...(group.isPrivate ? { isPrivate: group.isPrivate } : {}),
  };
}

export const GROUPS_MANIFEST_SCOPE = 'groups:v1';
