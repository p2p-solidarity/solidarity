import { describe, expect, it } from 'bun:test';

import { createEthCall, ETHEREUM_RPC_ENDPOINTS } from '@/domains/ethereumRpc';

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

describe('createEthCall', () => {
  it('posts an eth_call to the configured primary endpoint', async () => {
    const requests: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: urlOf(input), init });
      return Promise.resolve(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x1234' }))
      );
    }) as typeof fetch;
    const ethCall = createEthCall({ fetchImpl });

    expect(await ethCall('0x0000000000000000000000000000000000000001', '0xabcdef')).toEqual({
      ok: true,
      value: '0x1234',
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(ETHEREUM_RPC_ENDPOINTS[0]);
    expect(requests[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: '0x0000000000000000000000000000000000000001', data: '0xabcdef' }, 'latest'],
    });
  });

  it('tries the next configured endpoint after a transport failure', async () => {
    const urls: string[] = [];
    const fetchImpl = ((input: RequestInfo | URL) => {
      const url = urlOf(input);
      urls.push(url);
      return url === ETHEREUM_RPC_ENDPOINTS[0]
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(
            new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xabcd' }))
          );
    }) as typeof fetch;
    const ethCall = createEthCall({ fetchImpl });

    expect(await ethCall('0x0000000000000000000000000000000000000001', '0x00')).toEqual({
      ok: true,
      value: '0xabcd',
    });
    expect(urls).toEqual([...ETHEREUM_RPC_ENDPOINTS]);
  });

  it('returns unreachable when every endpoint returns an RPC error or malformed result', async () => {
    let calls = 0;
    const fetchImpl = (() => {
      calls += 1;
      const body =
        calls === 1
          ? { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'reverted' } }
          : { jsonrpc: '2.0', id: 1, result: 'not-hex' };
      return Promise.resolve(new Response(JSON.stringify(body)));
    }) as unknown as typeof fetch;
    const ethCall = createEthCall({ fetchImpl });

    expect(await ethCall('0x0000000000000000000000000000000000000001', '0x00')).toEqual({
      ok: false,
      error: 'unreachable',
    });
    expect(calls).toBe(2);
  });

  it('keeps every default endpoint HTTPS and outside inline call logic', () => {
    expect(ETHEREUM_RPC_ENDPOINTS).toHaveLength(2);
    expect(
      ETHEREUM_RPC_ENDPOINTS.every((endpoint) => new URL(endpoint).protocol === 'https:')
    ).toBe(true);
  });
});
