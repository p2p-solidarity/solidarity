import { signNostrEvent } from '@/nostr/userKey';
import {
  base64Encode,
  bytesToHex,
  sha256Bytes,
  utf8ToBytes,
} from '@solidarity/shared';

export const NIP05_SERVICE_ORIGIN = 'https://solidarity.gg';
const REQUEST_TIMEOUT_MS = 10_000;

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type SignEvent = typeof signNostrEvent;

export type Nip05UnavailableReason = 'reserved' | 'invalid' | 'taken' | 'tombstoned';

export type Nip05Availability =
  | { readonly status: 'available'; readonly name: string }
  | { readonly status: 'unavailable'; readonly name: string; readonly reason: Nip05UnavailableReason }
  | { readonly status: 'unreachable'; readonly name: string };

export interface Nip05ClientOptions {
  readonly fetchImpl?: FetchImpl;
  readonly timeoutMs?: number;
}

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

interface RegisterOptions extends Nip05ClientOptions {
  readonly name: string;
  readonly relays: readonly string[];
  readonly signEvent?: SignEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function fetchWithTimeout(
  fetchImpl: FetchImpl,
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text());
  } catch {
    return null;
  }
}

export async function checkNip05Availability(
  rawName: string,
  options: Nip05ClientOptions = {}
): Promise<Nip05Availability> {
  const name = rawName.trim().toLowerCase();
  const url = `${NIP05_SERVICE_ORIGIN}/id/availability?name=${encodeURIComponent(name)}`;
  const response = await fetchWithTimeout(
    options.fetchImpl ?? fetch,
    url,
    { method: 'GET', headers: { accept: 'application/json' } },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS
  );
  if (response === null || !response.ok) return { status: 'unreachable', name };

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
  options: Nip05ClientOptions = {}
): Promise<readonly string[]> {
  const candidates = nip05NameSuggestions(rawName);
  const results = await Promise.all(
    candidates.map((candidate) => checkNip05Availability(candidate, options))
  );
  return results.flatMap((result) => result.status === 'available' ? [result.name] : []);
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

export async function registerNip05Name(options: RegisterOptions): Promise<Nip05Registration> {
  const name = options.name.trim().toLowerCase();
  const url = `${NIP05_SERVICE_ORIGIN}/id/register`;
  const body = JSON.stringify({ name, relays: options.relays, consent: true });
  const payloadHash = bytesToHex(sha256Bytes(utf8ToBytes(body)));
  const signed = await (options.signEvent ?? signNostrEvent)({
    kind: 27_235,
    tags: [
      ['u', url],
      ['method', 'POST'],
      ['payload', payloadHash],
    ],
    content: '',
  });
  if (!signed.ok) return { ok: false, error: 'invalid_auth' };

  const authorization = `Nostr ${base64Encode(utf8ToBytes(JSON.stringify(signed.value)))}`;
  const response = await fetchWithTimeout(
    options.fetchImpl ?? fetch,
    url,
    {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization,
        'content-type': 'application/json',
      },
      body,
    },
    options.timeoutMs ?? REQUEST_TIMEOUT_MS
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
  return {
    ok: true,
    name,
    pubkey: responseBody['pubkey'],
    identifier: responseBody['identifier'],
  };
}
