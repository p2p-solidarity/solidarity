import { describe, expect, it } from 'bun:test';

import { verifyHttpsOwnership } from '../../src/profile/httpsOwnership';

describe('verifyHttpsOwnership', () => {
  it('accepts a same-origin HTTPS DID document that names the current DID', async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      expect(String(input)).toBe('https://kidney.dev/.well-known/did.json');
      return new Response(JSON.stringify({ id: 'did:key:zAlice' }), {
        headers: { 'content-type': 'application/json' },
      });
    };

    const evidence = await verifyHttpsOwnership({
      did: 'did:key:zAlice',
      links: ['https://kidney.dev/about'],
      profileUrls: ['https://solidarity.gg/#alice'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(evidence).toEqual([
      {
        method: 'did-document',
        origin: 'https://kidney.dev',
        proofUrl: 'https://kidney.dev/.well-known/did.json',
      },
    ]);
  });

  it('accepts an HTTPS page with a reciprocal rel=me profile link', async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url.endsWith('/.well-known/did.json')) return new Response('', { status: 404 });
      expect(url).toBe('https://alice.example/about');
      return new Response(
        '<html><head><link href="https://solidarity.gg/#alice" rel="alternate me"></head></html>',
        { headers: { 'content-type': 'text/html' } },
      );
    };

    const evidence = await verifyHttpsOwnership({
      did: 'did:key:zAlice',
      links: ['https://alice.example/about'],
      profileUrls: ['https://solidarity.gg/#alice'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(evidence).toEqual([
      {
        method: 'rel-me',
        origin: 'https://alice.example',
        proofUrl: 'https://alice.example/about',
      },
    ]);
  });

  it('does not treat HTTPS alone as ownership and never fetches private hosts', async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      calls.push(String(input));
      return new Response('<html><body>no reciprocal proof</body></html>');
    };

    const evidence = await verifyHttpsOwnership({
      did: 'did:key:zAlice',
      links: [
        'https://127.0.0.1/private',
        'https://user:secret@example.net/private',
        'https://example.com',
      ],
      profileUrls: ['https://solidarity.gg/#alice'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(evidence).toEqual([]);
    expect(calls).toEqual([
      'https://example.com/.well-known/did.json',
      'https://example.com/',
    ]);
  });

  it('rejects a proof response redirected away from the claimed HTTPS origin', async () => {
    const fetchImpl = async (): Promise<Response> => {
      const response = new Response(JSON.stringify({ id: 'did:key:zAlice' }));
      Object.defineProperty(response, 'url', { value: 'https://attacker.example/did.json' });
      return response;
    };

    const evidence = await verifyHttpsOwnership({
      did: 'did:key:zAlice',
      links: ['https://alice.example'],
      profileUrls: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(evidence).toEqual([]);
  });

  it('cancels a chunked response as soon as it crosses the byte cap', async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(40 * 1024));
        if (pulls >= 5) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = async (): Promise<Response> => new Response(stream);

    const evidence = await verifyHttpsOwnership({
      did: 'did:key:zAlice',
      links: ['https://alice.example'],
      profileUrls: [],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(evidence).toEqual([]);
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it('ignores rel=me text inside comments and inert script content', async () => {
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).endsWith('/.well-known/did.json')) {
        return new Response('', { status: 404 });
      }
      return new Response(
        '<!-- <a rel="me" href="https://solidarity.gg/#alice"> -->' +
          '<script>const example = `<a rel="me" href="https://solidarity.gg/#alice">`;</script>',
      );
    };

    const evidence = await verifyHttpsOwnership({
      did: 'did:key:zAlice',
      links: ['https://alice.example'],
      profileUrls: ['https://solidarity.gg/#alice'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(evidence).toEqual([]);
  });
});
