import { err, ok, type Result } from '@solidarity/shared';

const BLUESKY_PROFILE_ENDPOINT =
  'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';

export const BLUESKY_AVATAR_TIMEOUT_MS = 15_000;
export const BLUESKY_AVATAR_MAX_RESPONSE_BYTES = 1_048_576;

export type BlueskyAvatarError =
  | 'invalidActor'
  | 'unreachable'
  | 'notFound'
  | 'invalidResponse'
  | 'avatarUnavailable'
  | 'insecureAvatar';

export interface FetchBlueskyAvatarOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function safeUri(value: string | null, protocol: 'https:' | 'file:'): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === protocol ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Signed https photo first, device-owned file second, otherwise the initial. */
export function resolveProfileAvatarSource(
  recordAvatar: string | null,
  localAvatar: string | null
): string | null {
  return safeUri(recordAvatar, 'https:') ?? safeUri(localAvatar, 'file:');
}

/** Parse only the public field this feature needs; never retain the response body. */
export function parseBlueskyAvatarResponse(
  value: unknown
): Result<string, BlueskyAvatarError> {
  if (!isRecord(value)) return err('invalidResponse');
  const avatar = value['avatar'];
  if (avatar === undefined || avatar === null || avatar === '') {
    return err('avatarUnavailable');
  }
  if (typeof avatar !== 'string') return err('invalidResponse');

  try {
    const url = new URL(avatar);
    return url.protocol === 'https:' ? ok(url.toString()) : err('insecureAvatar');
  } catch {
    return err('invalidResponse');
  }
}

/**
 * Read a Bluesky avatar from the public AppView. The actor is the DID from
 * the already-completed OAuth session, never user-entered profile data.
 */
export async function fetchBlueskyAvatar(
  actorDid: string,
  options: FetchBlueskyAvatarOptions = {}
): Promise<Result<string, BlueskyAvatarError>> {
  if (!actorDid.startsWith('did:')) return err('invalidActor');

  const endpoint = new URL(BLUESKY_PROFILE_ENDPOINT);
  endpoint.searchParams.set('actor', actorDid);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? BLUESKY_AVATAR_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? BLUESKY_AVATAR_MAX_RESPONSE_BYTES;
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetchImpl(endpoint.toString(), {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      return err('unreachable');
    }

    if (response.status === 404) return err('notFound');
    if (!response.ok) return err('unreachable');

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const length = Number(declaredLength);
      if (Number.isFinite(length) && length > maxResponseBytes) {
        return err('unreachable');
      }
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      return err('unreachable');
    }
    if (utf8ByteLength(body) > maxResponseBytes) return err('unreachable');

    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return err('invalidResponse');
    }
    return parseBlueskyAvatarResponse(parsed);
  } finally {
    clearTimeout(timeout);
  }
}
