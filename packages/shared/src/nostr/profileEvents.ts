/**
 * The two Nostr events a Verified Page publishes (01-spec §4/§5), as pure
 * builders so the app and the web builder emit the same wire:
 *
 *   - kind 30078 (NIP-78 parameterised replaceable), `d = solidarity.profile`,
 *     `content` = the profile compact JWS verbatim — the profile pointer the
 *     `#nostr:<npub>` / `/@name` resolvers read;
 *   - kind 0 (metadata) with a top-level `alsoKnownAs: [did:key…]` (the
 *     reverse half of the did↔npub binding) and, once a short name is
 *     registered, `nip05: name@<NIP05_DOMAIN>`. Every other kind-0 field the
 *     user already published (`name`, `about`, `picture`, foreign
 *     `alsoKnownAs` entries) is preserved verbatim.
 */
import { NIP05_DOMAIN } from '../handles/nip05';

import type { UnsignedNostrEvent } from './event';

/** NIP-78 `d` tag identifying the profile-pointer event (01-spec §4). */
export const PROFILE_D_TAG = 'solidarity.profile';
/** NIP-78 parameterised-replaceable-event kind used for the profile pointer. */
export const KIND_PROFILE_POINTER = 30078;
/** NIP-01 metadata (kind-0) event kind. */
export const KIND_METADATA = 0;

export function buildProfilePointerEvent(jws: string, createdAt?: number): UnsignedNostrEvent {
  return {
    kind: KIND_PROFILE_POINTER,
    tags: [['d', PROFILE_D_TAG]],
    content: jws,
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
  };
}

/** Tolerant kind-0 content parse: anything that is not a JSON object is an empty base. */
export function parseKind0Content(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** `name@<domain>` as the directory issues it — the only shape kind-0 may carry. */
export function isNip05Identifier(value: string, domain: string = NIP05_DOMAIN): boolean {
  return new RegExp(`^[a-z0-9]{3,30}@${escapeRegExp(domain)}$`, 'u').test(value);
}

export interface Kind0Bindings {
  /** The user's did:key — merged into `alsoKnownAs` (set semantics, order kept). */
  readonly did: string;
  /** Optional short-name claim; omit to preserve whatever kind-0 already says. */
  readonly nip05?: string;
}

/**
 * Merge the Solidarity bindings into an existing kind-0 content object without
 * disturbing anything else in it. Idempotent: the same `did` is never added
 * twice.
 */
export function mergeKind0Content(base: Record<string, unknown>, bindings: Kind0Bindings): Record<string, unknown> {
  const existing = Array.isArray(base['alsoKnownAs'])
    ? base['alsoKnownAs'].filter((value): value is string => typeof value === 'string')
    : [];
  const alsoKnownAs = new Set(existing);
  alsoKnownAs.add(bindings.did);
  return {
    ...base,
    ...(bindings.nip05 === undefined ? {} : { nip05: bindings.nip05 }),
    alsoKnownAs: [...alsoKnownAs],
  };
}

export function buildKind0Event(content: Record<string, unknown>, createdAt?: number): UnsignedNostrEvent {
  return {
    kind: KIND_METADATA,
    tags: [],
    content: JSON.stringify(content),
    ...(createdAt === undefined ? {} : { created_at: createdAt }),
  };
}
