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

/**
 * The viewer renders every `links[].url` as a clickable `<a href>` anchor,
 * so only `http://`/`https://` (case-insensitive) may pass — a
 * `javascript:`/`data:`/any other scheme URI must never reach an anchor tag.
 * No implicit trim: a leading- or trailing-whitespace URL is rejected
 * outright rather than silently normalized, since whitespace before the
 * scheme is a classic sanitizer-bypass trick against naive
 * `url.startsWith('http')`-style checks.
 */
const LINK_URL_SCHEME_RE = /^https?:\/\//i;
const isRenderableLinkUrl = (url: string): boolean => url === url.trim() && LINK_URL_SCHEME_RE.test(url);

export const profileLinkSchema = z
  .object({
    label: z.string(),
    url: z.string().refine(isRenderableLinkUrl, {
      message: 'must be an http:// or https:// URL with no leading/trailing whitespace',
    }),
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

/**
 * Publication scope of a signed Profile Record (T7, `notes-1.3.3-publishing-
 * pairing-research.md` §3 / grill G4). Per-item `visibility` (public /
 * link-only / private) is a LOCAL-only tag that never enters the wire record;
 * what DOES travel is which of three PROJECTIONS this signed record is:
 *   - `public` → published to Nostr/PDS: only `public`-tier items.
 *   - `shared` → direct QR / URL-fragment share: `public` + `link-only` items.
 *   - `full`   → Pear private exchange / local source of truth: all items.
 * All three are signed by the SAME root did:key — they are projections, not
 * different identities. The field is OPTIONAL and back-compat: an absent
 * `scope` means `full` (every record written before T7, and every Pear/full
 * record, omits it). The People-side snapshot store keys verified snapshots by
 * `(did, scope)` so a `public` projection and a `full` card for one did coexist
 * instead of being flagged a conflict (see `profileSnapshots.ts`).
 */
export const profileScopeSchema = z.enum(['public', 'shared', 'full']);
export type ProfileScope = z.infer<typeof profileScopeSchema>;

export const profileRecordSchema = z
  .object({
    v: z.literal(PROFILE_VERSION),
    did: z.string().min(1),
    displayName: z.string(),
    /**
     * URL string, blob-hash string, or absent avatar. Free-form by design —
     * unlike `links[].url`, this field is NOT scheme-validated here (it
     * must be able to hold an opaque blob-hash, not just a URL). Rendering
     * an `avatar` value is entirely the consumer's responsibility: never
     * treat it as a navigable/clickable URL (`<a href>`, `Linking.openURL`,
     * WebView navigation, ...) without the consumer doing its own scheme
     * validation first.
     */
    avatar: z.string().nullable(),
    bio: z.string(),
    links: z.array(profileLinkSchema),
    alsoKnownAs: z.array(z.string()),
    badges: z.array(profileBadgeSchema),
    /** Non-null once this DID has been superseded by a key rotation (01-spec §3). */
    supersededBy: z.string().nullable(),
    /**
     * Which projection this signed record is (T7 — see `profileScopeSchema`).
     * OPTIONAL; absent = `full`. Kept strict-accepting: a record with no
     * `scope` (every pre-T7 record, every Pear/full card) still parses, and a
     * record with an unknown `scope` value fails closed.
     */
    scope: profileScopeSchema.optional(),
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
