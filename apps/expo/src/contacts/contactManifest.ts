/**
 * Contact manifest — minimal non-sensitive fields the People list / picker
 * surfaces need on frame 1. Stored plaintext (well: MMKV-encrypted, not
 * per-record AES) so cold launch can render rows without decrypting every
 * Contact record up front.
 *
 * Full Contact (email, phone, profile image, notes, sealed-route + signing
 * keys, exchange signatures, ephemeral messages, last-interaction) stays
 * in the encrypted `contacts:{id}` keys and is decrypted lazily on detail
 * open or via `hydrate()` in the background.
 *
 * Safe to include here (rendered or used by list-level filters):
 *   - id                 — opaque UUID
 *   - name               — already displayed on every row / picker
 *   - title / company    — already displayed alongside the name
 *   - source             — drives the "#Phone Contacts" / "Added manually"
 *                          / "Met in person" context tag without leaking
 *                          per-contact data
 *   - tags               — user-supplied labels, already shown
 *   - receivedAt (ISO)   — list sort + ISO date stamp on each row. Stored
 *                          as a string so the manifest JSON round-trips
 *                          without bespoke Date coercion (consumers re-coerce
 *                          when they need a Date instance)
 *   - verificationStatus — drives the verified checkmark badge on the row
 *
 * Excluded (kept encrypted-only): `email`, `phone`, `profileImage`,
 * `notes`, `sealedRoute`, `pubKey`, `signPubKey`, `didPublicKey`,
 * exchange signatures, ephemeral messages, `lastInteraction`, `animal`.
 */
import type {
  Contact,
  ContactSource,
  VerificationStatus,
} from '@solidarity/shared';

export interface ContactManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly title?: string;
  readonly company?: string;
  readonly source: ContactSource;
  readonly tags: readonly string[];
  /** ISO-8601 string. Consumers that need a Date should `new Date(entry.receivedAt)`. */
  readonly receivedAt: string;
  readonly verificationStatus: VerificationStatus;
}

export function toContactManifest(contact: Contact): ContactManifestEntry {
  return {
    id: contact.id,
    name: contact.businessCard.name,
    ...(contact.businessCard.title ? { title: contact.businessCard.title } : {}),
    ...(contact.businessCard.company ? { company: contact.businessCard.company } : {}),
    source: contact.source,
    tags: contact.tags,
    receivedAt: contact.receivedAt.toISOString(),
    verificationStatus: contact.verificationStatus,
  };
}

export const CONTACTS_MANIFEST_SCOPE = 'contacts:v1';
