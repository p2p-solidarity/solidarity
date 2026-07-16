/**
 * App-side IO adapter for the shared ATProto binding verifier (task S2).
 * No test performs real DNS or HTTP IO.
 */
import { describe, expect, it } from 'bun:test';

import { createAtprotoBindingIO } from '@/atproto/bindingIo';
import { ok } from '@solidarity/shared';

const DID = 'did:plc:aliceexample1234';

interface CapturedRequest {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
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

describe('AtprotoBindingIO.dnsTxt', () => {
  it('parses TXT answers from Cloudflare DoH using the DNS JSON accept header', async () => {
    const captured: CapturedRequest[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      captured.push({ url: urlOf(input), init });
      return Promise.resolve(
        json({
          Status: 0,
          Answer: [
            { name: '_atproto.alice.example.', type: 1, data: '192.0.2.1' },
            { name: '_atproto.alice.example.', type: 16, data: `"did=${DID}"` },
          ],
        })
      );
    }) as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });

    const result = await io.dnsTxt('_atproto.alice.example');

    expect(result).toEqual({ ok: true, value: [`"did=${DID}"`] });
    expect(captured).toHaveLength(1);
    const url = new URL(captured[0]?.url ?? 'https://invalid.example');
    expect(url.origin).toBe('https://cloudflare-dns.com');
    expect(url.searchParams.get('name')).toBe('_atproto.alice.example');
    expect(url.searchParams.get('type')).toBe('TXT');
    expect(new Headers(captured[0]?.init?.headers).get('accept')).toBe('application/dns-json');
  });

  it('maps NXDOMAIN to notFound without querying the fallback resolver', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      return Promise.resolve(json({ Status: 3 }));
    }) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });

    const result = await io.dnsTxt('_atproto.missing.example');

    expect(result).toEqual({ ok: false, error: 'notFound' });
    expect(calls).toBe(1);
  });

  it('maps a successful DNS response with no TXT answers to ok(empty)', async () => {
    const fetchImpl = (() =>
      Promise.resolve(json({ Status: 0, Answer: [] }))) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });
    expect(await io.dnsTxt('_atproto.no-txt.example')).toEqual({
      ok: true,
      value: [],
    });
  });

  it('falls back to Google DoH only when Cloudflare is unreachable', async () => {
    const urls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = urlOf(input);
      urls.push(url);
      if (url.startsWith('https://cloudflare-dns.com/')) {
        return Promise.reject(new Error('offline'));
      }
      return Promise.resolve(json({ Status: 0, Answer: [{ type: 16, data: `"did=${DID}"` }] }));
    }) as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });

    const result = await io.dnsTxt('_atproto.alice.example');

    expect(result).toEqual({ ok: true, value: [`"did=${DID}"`] });
    expect(urls).toHaveLength(2);
    expect(urls[1]).toStartWith('https://dns.google/resolve?');
  });

  it('reports unreachable when both DoH resolvers fail', async () => {
    const fetchImpl = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });
    expect(await io.dnsTxt('_atproto.alice.example')).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });
});

describe('AtprotoBindingIO.fetchText', () => {
  it('rejects non-HTTPS input before touching fetch', async () => {
    let called = false;
    const fetchImpl = (() => {
      called = true;
      return Promise.resolve(new Response('should not happen'));
    }) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });

    expect(await io.fetchText('http://alice.example/.well-known/atproto-did')).toEqual({
      ok: false,
      error: 'insecureEndpoint',
    });
    expect(called).toBe(false);
  });

  it('maps 404 to notFound', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('', { status: 404 }))) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });
    expect(await io.fetchText('https://alice.example/.well-known/atproto-did')).toEqual({
      ok: false,
      error: 'notFound',
    });
  });

  it('maps rate limiting to unreachable so verification remains stale, not declared', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response('', { status: 429 }))) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl });
    expect(await io.fetchText('https://alice.example/.well-known/atproto-did')).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('enforces the response byte cap before reading an oversized declared body', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response('0123456789abcdef', {
          headers: { 'content-length': '16' },
        })
      )) as unknown as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl, maxResponseBytes: 8 });
    expect(await io.fetchText('https://alice.example/.well-known/atproto-did')).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('times out a fetch that does not settle', async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      })) as typeof fetch;
    const io = createAtprotoBindingIO({ fetchImpl, timeoutMs: 1 });
    expect(await io.fetchText('https://alice.example/.well-known/atproto-did')).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });
});

describe('AtprotoBindingIO.getRecord', () => {
  it('delegates the fixed shared verifier request to getProfileRecord', async () => {
    const record = {
      uri: `at://${DID}/app.solidarity.profile/self`,
      value: { jws: 'profile.jws' },
    };
    const fetchImpl = (() => Promise.reject(new Error('unused'))) as unknown as typeof fetch;
    const delegated: { repo: string | null; fetchImpl: typeof fetch | null } = {
      repo: null,
      fetchImpl: null,
    };
    const io = createAtprotoBindingIO({
      fetchImpl,
      getProfileRecordImpl: (repoDid, options) => {
        delegated.repo = repoDid;
        delegated.fetchImpl = options?.fetchImpl ?? null;
        return Promise.resolve(ok(record));
      },
    });

    const result = await io.getRecord(DID, 'app.solidarity.profile', 'self');

    expect(result).toEqual({ ok: true, value: record });
    expect(delegated.repo).toBe(DID);
    expect(delegated.fetchImpl).toBe(fetchImpl);
  });
});
