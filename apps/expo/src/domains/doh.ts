import { err, ok, type ResolverIoError, type Result } from '@solidarity/shared';

import { readResponseTextBounded } from './boundedText';

export const DOH_RESOLVERS = [
  { origin: 'https://cloudflare-dns.com', pathname: '/dns-query' },
  { origin: 'https://dns.google', pathname: '/resolve' },
] as const;

export const DOH_TIMEOUT_MS = 15_000;
export const DOH_MAX_RESPONSE_BYTES = 1_048_576;

export interface DohQueryOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDnsJson(value: unknown): Result<readonly string[], ResolverIoError> {
  if (!isRecord(value) || typeof value['Status'] !== 'number') return err('unreachable');
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

function queryUrl(resolver: (typeof DOH_RESOLVERS)[number], name: string): string {
  const url = new URL(resolver.pathname, resolver.origin);
  url.searchParams.set('name', name);
  url.searchParams.set('type', 'TXT');
  return url.toString();
}

async function queryOne(
  resolver: (typeof DOH_RESOLVERS)[number],
  name: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  maxResponseBytes: number
): Promise<Result<readonly string[], ResolverIoError>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(queryUrl(resolver, name), {
        headers: { accept: 'application/dns-json' },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      return err('unreachable');
    }
    if (!response.ok) return err('unreachable');

    const text = await readResponseTextBounded(response, maxResponseBytes, controller);
    if (!text.ok) return err('unreachable');

    let value: unknown;
    try {
      value = JSON.parse(text.value);
    } catch {
      return err('unreachable');
    }
    return parseDnsJson(value);
  } finally {
    clearTimeout(timeout);
  }
}

function canonicalRecords(records: readonly string[]): readonly string[] {
  return [...new Set(records)].sort((left, right) => left.localeCompare(right));
}

/** Cloudflare + Google must independently agree; any partial view stays unreachable. */
export async function queryDnsTxtCrossChecked(
  name: string,
  options: DohQueryOptions = {}
): Promise<Result<readonly string[], ResolverIoError>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DOH_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DOH_MAX_RESPONSE_BYTES;
  try {
    const [cloudflare, google] = await Promise.all(
      DOH_RESOLVERS.map((resolver) =>
        queryOne(resolver, name, fetchImpl, timeoutMs, maxResponseBytes)
      )
    );
    if (!cloudflare || !google) return err('unreachable');
    if (!cloudflare.ok || !google.ok) {
      return !cloudflare.ok &&
        !google.ok &&
        cloudflare.error === 'notFound' &&
        google.error === 'notFound'
        ? err('notFound')
        : err('unreachable');
    }
    const left = canonicalRecords(cloudflare.value);
    const right = canonicalRecords(google.value);
    return left.length === right.length && left.every((record, index) => record === right[index])
      ? ok(left)
      : err('unreachable');
  } catch {
    return err('unreachable');
  }
}
