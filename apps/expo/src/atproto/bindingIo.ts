/**
 * React Native IO adapter for `@solidarity/shared`'s pure ATProto binding
 * verifier. DNS uses cross-checked Cloudflare + Google JSON DoH; HTTPS text
 * reads are timeout- and byte-bounded; record reads delegate to `pds.ts`'s
 * DID-routed public XRPC transport.
 */
import {
  err,
  ok,
  type AtprotoBindingIO,
  type ResolverIoError,
  type Result,
} from '@solidarity/shared';

import { queryDnsTxtCrossChecked } from '@/domains/doh';
import { createEthCall } from '@/domains/ethereumRpc';
import { readResponseTextBounded } from '@/domains/boundedText';

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

function redirectFailure(response: Response, requestedUrl: string): ResolverIoError | null {
  if (response.url.length > 0 && !isHttpsUrl(response.url)) return 'insecureEndpoint';
  if (response.status < 300 || response.status >= 400) return null;

  const location = response.headers.get('location');
  if (location === null) return 'unreachable';
  try {
    return isHttpsUrl(new URL(location, requestedUrl).toString())
      ? 'unreachable'
      : 'insecureEndpoint';
  } catch {
    return 'unreachable';
  }
}

async function fetchTextBounded(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxResponseBytes: number
): Promise<Result<BoundedResponse, ResolverIoError>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      return err('unreachable');
    }

    const redirectError = redirectFailure(response, url);
    // The fixed well-known endpoint is authoritative; do not silently
    // follow even an HTTPS redirect to a different retrieval location.
    if (redirectError !== null) return err(redirectError);

    const text = await readResponseTextBounded(response, maxResponseBytes, controller);
    return text.ok
      ? ok({ status: response.status, ok: response.ok, text: text.value })
      : err('unreachable');
  } finally {
    clearTimeout(timeout);
  }
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
      return queryDnsTxtCrossChecked(name, { fetchImpl, timeoutMs, maxResponseBytes });
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

    ethCall: createEthCall({ fetchImpl, timeoutMs, maxResponseBytes }),

    getRecord: (repoDid, _collection, _rkey) => readRecord(repoDid, { fetchImpl }),
  };
}

/** Default app adapter; consumers that need deterministic IO use the factory. */
export const atprotoBindingIO = createAtprotoBindingIO();
