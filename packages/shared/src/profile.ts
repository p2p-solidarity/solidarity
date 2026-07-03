/**
 * Profile Record — the canonical identity payload signed as a compact JWS
 * (jws.ts) and published to atproto/Nostr/URL-fragment (01-spec §3, §4).
 * This module owns only the schema + a `Result`-returning parser, never
 * signing or transport (see fragment.ts for the URL-fragment codec).
 *
 * Field shape is frozen exactly to 01-spec §3's JSON example:
 *   { v, did, displayName, avatar, bio, links[], alsoKnownAs[], badges[],
 *     supersededBy, updatedAt }
 * `.strict()` so an unrecognized extra top-level key fails closed — in
 * particular, an earlier spec draft carried a `recoveryKey` field that
 * 01-spec §3 (current) does not; the App/Web key-recovery story (iCloud
 * Keychain / mnemonic, §3 "金鑰生命週期") lives entirely outside the
 * Profile Record, so a payload smuggling `recoveryKey` back in must be
 * rejected, not silently accepted.
 *
 * `alsoKnownAs` is intentionally NOT cross-checked against `badges` here:
 * a claimed handle (`at://alice.bsky.social`, `dns:example.com`, ...) may
 * appear in `alsoKnownAs` before its reverse binding exists on the
 * platform side — a one-way claim, structurally valid but not yet a
 * green-check badge (01-spec §6: "兩向都成立才畫綠勾"). Badge
 * *verification* is a later task's job; this schema only enforces shape.
 * `vectors/profile.json`'s `one-way-also-known-as` vector documents this
 * distinction explicitly so it isn't "fixed" by mistake later.
 */
import { z } from 'zod';

import { err, ok, type Result } from './types/result';

export const PROFILE_VERSION = 1;

export const profileLinkSchema = z
  .object({
    label: z.string(),
    url: z.string(),
  })
  .strict();
export type ProfileLink = z.infer<typeof profileLinkSchema>;

export const profileBadgeSchema = z
  .object({
    type: z.string(),
    subject: z.string(),
    /** Opaque reference or inline attestation blob — shape owned by the badge type, not this schema. */
    attestation: z.string(),
  })
  .strict();
export type ProfileBadge = z.infer<typeof profileBadgeSchema>;

export const profileRecordSchema = z
  .object({
    v: z.literal(PROFILE_VERSION),
    did: z.string().min(1),
    displayName: z.string(),
    /** URL string, blob-hash string, or absent avatar. */
    avatar: z.string().nullable(),
    bio: z.string(),
    links: z.array(profileLinkSchema),
    alsoKnownAs: z.array(z.string()),
    badges: z.array(profileBadgeSchema),
    /** Non-null once this DID has been superseded by a key rotation (01-spec §3). */
    supersededBy: z.string().nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type ProfileRecord = z.infer<typeof profileRecordSchema>;

/**
 * Parse + validate an unknown value as a `ProfileRecord`. Never throws —
 * every rejection path returns `err(reason)` describing every failing
 * field (path-prefixed, `;`-joined) so callers and vector tests can assert
 * on the offending field name without depending on zod's exact wording.
 */
export function parseProfile(json: unknown): Result<ProfileRecord, string> {
  const result = profileRecordSchema.safeParse(json);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`)
      .join('; ');
    return err(`invalid profile: ${detail}`);
  }
  return ok(result.data);
}
