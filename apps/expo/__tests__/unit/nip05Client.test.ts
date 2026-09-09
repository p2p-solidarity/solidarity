import { describe, expect, it } from 'bun:test';

import { checkNip05Availability, registerNip05Name } from '@/nip05/client';
import { ok } from '@solidarity/shared';

describe('NIP-05 app client', () => {
  it('checks availability against the authoritative Solidarity endpoint', async () => {
    const requests: string[] = [];
    const result = await checkNip05Availability('Alice', {
      fetchImpl: (input) => {
        requests.push(String(input));
        return Promise.resolve(new Response(JSON.stringify({ name: 'alice', available: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }));
      },
    });

    expect(result).toEqual({ status: 'available', name: 'alice' });
    expect(requests).toEqual(['https://creds.id/id/availability?name=alice']);
  });

  it('signs the exact registration body as a NIP-98 request', async () => {
    const requestBox: { value: Request | null } = { value: null };
    let unsignedEvent: unknown = null;
    const result = await registerNip05Name({
      name: 'alice',
      relays: ['wss://relay.example'],
      signEvent: async (unsigned) => {
        unsignedEvent = unsigned;
        return ok({
          id: '11'.repeat(32),
          pubkey: '22'.repeat(32),
          created_at: 1_776_038_400,
          kind: unsigned.kind,
          tags: unsigned.tags,
          content: unsigned.content,
          sig: '33'.repeat(64),
        });
      },
      fetchImpl: (input, init) => {
        requestBox.value = new Request(input, init);
        return Promise.resolve(new Response(JSON.stringify({
          name: 'alice',
          pubkey: '22'.repeat(32),
          identifier: 'alice@creds.id',
        }), { status: 200 }));
      },
    });

    expect(result).toEqual({
      ok: true,
      name: 'alice',
      pubkey: '22'.repeat(32),
      identifier: 'alice@creds.id',
    });
    expect(unsignedEvent).toMatchObject({
      kind: 27_235,
      content: '',
      tags: [
        ['u', 'https://creds.id/id/register'],
        ['method', 'POST'],
        ['payload', 'bc07e1e6d7a98f679717f1198d08418eb3bc917b73153785ae4e505383b247e7'],
      ],
    });
    const request = requestBox.value;
    if (request === null) throw new Error('registration request was not captured');
    expect(request.method).toBe('POST');
    expect(await request.clone().text()).toBe(
      '{"name":"alice","relays":["wss://relay.example"],"consent":true}'
    );
    expect(request.headers.get('authorization')).toStartWith('Nostr ');
    const payloadTag = (unsignedEvent as { tags: readonly (readonly string[])[] }).tags
      .find((tag) => tag[0] === 'payload');
    expect(payloadTag?.[1]).toBe(
      'bc07e1e6d7a98f679717f1198d08418eb3bc917b73153785ae4e505383b247e7'
    );
  });
});
