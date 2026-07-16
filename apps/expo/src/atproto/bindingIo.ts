/**
 * React Native IO adapter for `@solidarity/shared`'s pure ATProto binding
 * verifier. DNS uses JSON DoH (Cloudflare, then Google only when the first
 * resolver is unreachable); HTTPS text reads are timeout- and byte-bounded;
 * record reads delegate to `pds.ts`'s DID-routed public XRPC transport.
 */
import {
  err,
  ok,
  type AtprotoBindingIO,
  type ResolverIoError,
  type Result,
} from '@solidarity/shared';

import { getProfileRecord, type GetProfileRecordOptions } from './pds';

export const ATPROTO_IO_TIMEOUT_MS = 15_000;
export const ATPROTO_IO_MAX_RESPONSE_BYTES = 1_048_576;

type GetProfileRecord = (
  repoDid: string,
  options?: GetProfileRecordOptions
) => Promise<Result<unknown, ResolverIoError>>;

export interface AtprotoBindingIoOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  /** Test seam; production delegates to pds.ts. */
  readonly getProfileRecordImpl?: GetProfileRecord;
}

interface BoundedResponse {
  readonly status: number;
  readonly ok: boolean;
  readonly text: string;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

async function fetchTextBounded(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxResponseBytes: number
): Promise<Result<BoundedResponse, 'unreachable'>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      return err('unreachable');
    }

    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const length = Number(declaredLength);
      if (Number.isFinite(length) && length > maxResponseBytes) {
        return err('unreachable');
      }
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      return err('unreachable');
    }
    if (utf8ByteLength(text) > maxResponseBytes) return err('unreachable');
    return ok({ status: response.status, ok: response.ok, text });
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDnsJson(text: string): Result<readonly string[], ResolverIoError> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err('unreachable');
  }
  if (!isRecord(value) || typeof value['Status'] !== 'number') {
    return err('unreachable');
  }
  if (value['Status'] === 3) return err('notFound');
  if (value['Status'] !== 0) return err('unreachable');

  const answers = value['Answer'];
  if (answers === undefined) return ok([]);
  if (!Array.isArray(answers)) return err('unreachable');

  const records: string[] = [];
  for (const answer of answers) {
    if (isRecord(answer) && answer['type'] === 16 && typeof answer['data'] === 'string') {
      records.push(answer['data']);
    }
  }
  return ok(records);
}

function dnsUrl(origin: string, pathname: string, name: string): string {
  const url = new URL(pathname, origin);
  url.searchParams.set('name', name);
  url.searchParams.set('type', 'TXT');
  return url.toString();
}

async function queryDnsTxt(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxResponseBytes: number
): Promise<Result<readonly string[], ResolverIoError>> {
  const response = await fetchTextBounded(
    url,
    { headers: { accept: 'application/dns-json' } },
    fetchImpl,
    timeoutMs,
    maxResponseBytes
  );
  if (!response.ok || !response.value.ok) return err('unreachable');
  return parseDnsJson(response.value.text);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Build an adapter with explicit IO for tests, web parity, and future clients. */
export function createAtprotoBindingIO(options: AtprotoBindingIoOptions = {}): AtprotoBindingIO {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ATPROTO_IO_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? ATPROTO_IO_MAX_RESPONSE_BYTES;
  const readRecord = options.getProfileRecordImpl ?? getProfileRecord;

  return {
    dnsTxt: async (name) => {
      try {
        const cloudflare = dnsUrl('https://cloudflare-dns.com', '/dns-query', name);
        const primary = await queryDnsTxt(cloudflare, fetchImpl, timeoutMs, maxResponseBytes);
        if (primary.ok || primary.error !== 'unreachable') return primary;

        const google = dnsUrl('https://dns.google', '/resolve', name);
        return await queryDnsTxt(google, fetchImpl, timeoutMs, maxResponseBytes);
      } catch {
        return err('unreachable');
      }
    },

    fetchText: async (url) => {
      if (!isHttpsUrl(url)) return err('insecureEndpoint');
      const response = await fetchTextBounded(url, {}, fetchImpl, timeoutMs, maxResponseBytes);
      if (!response.ok) return response;
      if (!response.value.ok) {
        return err(response.value.status === 404 ? 'notFound' : 'unreachable');
      }
      if (response.value.status === 204) return ok(null);
      return ok(response.value.text);
    },

    getRecord: (repoDid, _collection, _rkey) => readRecord(repoDid, { fetchImpl }),
  };
}

/** Default app adapter; consumers that need deterministic IO use the factory. */
export const atprotoBindingIO = createAtprotoBindingIO();
