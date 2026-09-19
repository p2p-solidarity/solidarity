/**
 * NIP-05 directory client — the app's `nip05/client.ts` core, made platform-
 * neutral so the web builder registers a short name through the very same
 * request shapes (07-plan 階段 3). The directory lives at `origin`
 * (`https://creds.id`); write requests carry a NIP-98 authorisation signed by
 * the caller's Nostr key (`signEvent` is injected — the key never comes here).
 *
 * `fetchImpl` is structural (`FetchLike`) rather than the DOM `fetch` type so
 * this compiles in the shared package and accepts React Native's, the
 * browser's, and a test fake alike. Timeouts race the request; a late answer
 * is simply discarded.
 */
import { base64Encode, utf8ToBytes } from '../crypto/base64';
import { sha256Bytes } from '../crypto/hash';
import { bytesToHex } from '../crypto/hex';
import type { Result } from '../types/result';

import type { NostrEvent, UnsignedNostrEvent } from '../nostr/event';

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export interface FetchInitLike {
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export type Nip05SignEvent = (unsigned: UnsignedNostrEvent) => Promise<Result<NostrEvent, string>>;

export const NIP05_REQUEST_TIMEOUT_MS = 10_000;
/** NIP-98 HTTP Auth event kind. */
export const NIP98_KIND = 27_235;

export type Nip05UnavailableReason = 'reserved' | 'invalid' | 'taken' | 'tombstoned';

export type Nip05Availability =
  | { readonly status: 'available'; readonly name: string }
  | { readonly status: 'unavailable'; readonly name: string; readonly reason: Nip05UnavailableReason }
  | { readonly status: 'unreachable'; readonly name: string };

export type Nip05Registration =
  | {
      readonly ok: true;
      readonly name: string;
      readonly pubkey: string;
      readonly identifier: string;
    }
  | {
      readonly ok: false;
      readonly error:
        | 'name_taken'
        | 'rename_too_soon'
        | 'rate_limited'
        | 'invalid_auth'
        | 'invalid_request'
        | 'unreachable'
        | 'server_error';
      readonly retryAt?: number;
    };

export interface Nip05ClientOptions {
  /** Directory origin, e.g. `https://creds.id`. */
  readonly origin: string;
  readonly fetchImpl: FetchLike;
  readonly timeoutMs?: number;
}

export interface Nip05RegisterOptions extends Nip05ClientOptions {
  readonly name: string;
  readonly relays: readonly string[];
  readonly signEvent: Nip05SignEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: FetchInitLike,
  timeoutMs: number
): Promise<FetchResponseLike | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => { resolve(null); }, timeoutMs);
  });
  try {
    return await Promise.race([fetchImpl(url, init).catch(() => null), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readJson(response: FetchResponseLike): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

export function normalizeNip05Input(rawName: string): string {
  return rawName.trim().toLowerCase();
}

export async function checkNip05Availability(rawName: string, options: Nip05ClientOptions): Promise<Nip05Availability> {
  const name = normalizeNip05Input(rawName);
  const url = `${options.origin}/id/availability?name=${encodeURIComponent(name)}`;
  const response = await fetchWithTimeout(
    options.fetchImpl,
    url,
    { method: 'GET', headers: { accept: 'application/json' } },
    options.timeoutMs ?? NIP05_REQUEST_TIMEOUT_MS
  );
  if (!response?.ok) return { status: 'unreachable', name };

  const body = await readJson(response);
  if (!isRecord(body) || body['name'] !== name || typeof body['available'] !== 'boolean') {
    return { status: 'unreachable', name };
  }
  if (body['available']) return { status: 'available', name };
  const reason = body['reason'];
  return reason === 'reserved' || reason === 'invalid' || reason === 'taken' || reason === 'tombstoned'
    ? { status: 'unavailable', name, reason }
    : { status: 'unreachable', name };
}

export function nip05NameSuggestions(rawName: string): readonly string[] {
  const base = rawName.trim().toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 29);
  if (base.length < 2) return [];
  return [1, 2, 3]
    .map((suffix) => `${base}${String(suffix)}`.slice(0, 30))
    .filter((candidate, index, values) => candidate !== rawName && values.indexOf(candidate) === index);
}

export async function findAvailableNip05Suggestions(
  rawName: string,
  options: Nip05ClientOptions
): Promise<readonly string[]> {
  const candidates = nip05NameSuggestions(rawName);
  const results = await Promise.all(candidates.map((candidate) => checkNip05Availability(candidate, options)));
  return results.flatMap((result) => (result.status === 'available' ? [result.name] : []));
}

function registrationFailure(status: number, body: unknown): Nip05Registration {
  const error = isRecord(body) && typeof body['error'] === 'string' ? body['error'] : '';
  const retryAt = isRecord(body) && typeof body['retryAt'] === 'number' ? body['retryAt'] : undefined;
  if (status === 409 && error === 'name_taken') return { ok: false, error: 'name_taken' };
  if (status === 429 && error === 'rename_too_soon') {
    return retryAt === undefined
      ? { ok: false, error: 'rename_too_soon' }
      : { ok: false, error: 'rename_too_soon', retryAt };
  }
  if (status === 429) return { ok: false, error: 'rate_limited' };
  if (status === 401) return { ok: false, error: 'invalid_auth' };
  if (status === 400) return { ok: false, error: 'invalid_request' };
  return { ok: false, error: 'server_error' };
}

/**
 * The NIP-98 `Authorization: Nostr <base64(event)>` header for one request:
 * a kind-27235 event whose tags pin the exact URL, method and body hash, so a
 * captured header cannot be replayed against another endpoint or payload.
 */
export async function buildNip98Authorization(
  url: string,
  method: string,
  body: string | null,
  signEvent: Nip05SignEvent
): Promise<Result<string, string>> {
  const tags: string[][] = [
    ['u', url],
    ['method', method.toUpperCase()],
  ];
  if (body !== null) tags.push(['payload', bytesToHex(sha256Bytes(utf8ToBytes(body)))]);
  const signed = await signEvent({ kind: NIP98_KIND, tags, content: '' });
  if (!signed.ok) return signed;
  return { ok: true, value: `Nostr ${base64Encode(utf8ToBytes(JSON.stringify(signed.value)))}` };
}

export async function registerNip05Name(options: Nip05RegisterOptions): Promise<Nip05Registration> {
  const name = normalizeNip05Input(options.name);
  const url = `${options.origin}/id/register`;
  const body = JSON.stringify({ name, relays: options.relays, consent: true });
  const authorization = await buildNip98Authorization(url, 'POST', body, options.signEvent);
  if (!authorization.ok) return { ok: false, error: 'invalid_auth' };

  const response = await fetchWithTimeout(
    options.fetchImpl,
    url,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: authorization.value,
        'content-type': 'application/json',
      },
      body,
    },
    options.timeoutMs ?? NIP05_REQUEST_TIMEOUT_MS
  );
  if (response === null) return { ok: false, error: 'unreachable' };
  const responseBody = await readJson(response);
  if (!response.ok) return registrationFailure(response.status, responseBody);
  if (
    !isRecord(responseBody) ||
    responseBody['name'] !== name ||
    typeof responseBody['pubkey'] !== 'string' ||
    typeof responseBody['identifier'] !== 'string'
  ) {
    return { ok: false, error: 'server_error' };
  }
  return { ok: true, name, pubkey: responseBody['pubkey'], identifier: responseBody['identifier'] };
}
