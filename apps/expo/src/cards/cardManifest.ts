/**
 * Card manifest — minimal non-sensitive fields the list / hero views need
 * on frame 1. Stored plaintext (well: MMKV-encrypted, not per-record AES)
 * so cold launch can render names + animals without decrypting each card.
 *
 * Full BusinessCard (email, phone, socials, sharing prefs, etc.) stays in
 * the encrypted `cards:{id}` keys and is decrypted lazily on detail open
 * or via `hydrate()` in the background.
 *
 * Safe to include:
 *   - id        — opaque UUID
 *   - name      — already displayed on lists/sheets
 *   - title     — already displayed on share/edit headers
 *   - company   — already displayed alongside title
 *   - animal    — enum → bundled asset (no PII)
 *
 * Excluded (kept encrypted): email, phone, profileImage (base64 blob),
 * socialNetworks, skills, sharingPreferences, verifiedFields.
 */
import type { Animal, BusinessCard } from '@solidarity/shared';

export interface CardManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly company?: string;
  readonly animal?: Animal;
}

export function toCardManifest(card: BusinessCard): CardManifestEntry {
  return {
    id: card.id,
    name: card.name,
    ...(card.title ? { title: card.title } : {}),
    ...(card.company ? { company: card.company } : {}),
    ...(card.animal ? { animal: card.animal } : {}),
  };
}

export const CARDS_MANIFEST_SCOPE = 'cards:v1';
