import { describe, expect, it } from 'bun:test';

import { DOH_RESOLVERS, queryDnsTxtCrossChecked } from '@/domains/doh';

function dnsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/dns-json' },
  });
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('queryDnsTxtCrossChecked', () => {
  it('queries Cloudflare and Google and accepts the same TXT RRset regardless of order', async () => {
    const requests: { readonly url: string; readonly accept: string | null }[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      requests.push({ url, accept: new Headers(init?.headers).get('accept') });
      const answers = url.startsWith(DOH_RESOLVERS[0]!.origin)
        ? [
            { type: 16, data: 'b' },
            { type: 16, data: 'a' },
          ]
        : [
            { type: 16, data: 'a' },
            { type: 16, data: 'b' },
          ];
      return Promise.resolve(dnsJson({ Status: 0, Answer: answers }));
    }) as typeof fetch;

    const result = await queryDnsTxtCrossChecked('_did.example.com', { fetchImpl });

    expect(result).toEqual({ ok: true, value: ['a', 'b'] });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.accept === 'application/dns-json')).toBe(true);
    for (const request of requests) {
      const url = new URL(request.url);
      expect(url.searchParams.get('name')).toBe('_did.example.com');
      expect(url.searchParams.get('type')).toBe('TXT');
    }
  });

  it('treats resolver disagreement as unreachable', async () => {
    const fetchImpl = ((input: RequestInfo | URL) => {
      const answer = urlOf(input).startsWith(DOH_RESOLVERS[0]!.origin)
        ? 'did=did:key:zOne'
        : 'did=did:key:zTwo';
      return Promise.resolve(dnsJson({ Status: 0, Answer: [{ type: 16, data: answer }] }));
    }) as typeof fetch;

    expect(await queryDnsTxtCrossChecked('_did.example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('treats a single-resolver failure as unreachable even when the other answers', async () => {
    const fetchImpl = ((input: RequestInfo | URL) => {
      if (urlOf(input).startsWith(DOH_RESOLVERS[0]!.origin)) {
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(
        dnsJson({ Status: 0, Answer: [{ type: 16, data: 'did=did:key:zOne' }] })
      );
    }) as typeof fetch;

    expect(await queryDnsTxtCrossChecked('_did.example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('returns notFound only when both resolvers independently report NXDOMAIN', async () => {
    const fetchImpl = (() => Promise.resolve(dnsJson({ Status: 3 }))) as unknown as typeof fetch;

    expect(await queryDnsTxtCrossChecked('_did.missing.example', { fetchImpl })).toEqual({
      ok: false,
      error: 'notFound',
    });
  });

  it('treats NXDOMAIN versus a successful empty answer as disagreement', async () => {
    const fetchImpl = ((input: RequestInfo | URL) =>
      Promise.resolve(
        urlOf(input).startsWith(DOH_RESOLVERS[0]!.origin)
          ? dnsJson({ Status: 3 })
          : dnsJson({ Status: 0, Answer: [] })
      )) as typeof fetch;

    expect(await queryDnsTxtCrossChecked('_did.example.com', { fetchImpl })).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });
});
