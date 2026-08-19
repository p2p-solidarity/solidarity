import { describe, expect, it } from 'bun:test';

import {
  AtprotoHandleResolver,
  DEFAULT_HANDLE_RESOLVERS,
  Nip05HandleResolver,
  resolveHandle,
  type HandleResolver,
  type ResolverIO,
} from '../src';
import { err, ok } from '../src/types/result';
import vectors from '../vectors/atproto-handle.json';

const unusedIo: ResolverIO = {
  dnsTxt: async () => ok([]),
  fetchText: async () => ok(null),
};

describe('resolveHandle', () => {
  it('keeps deterministic registry priority: ENS reserved suffix, then ATProto, explicit/hinted DNS, then dotless NIP-05 names', () => {
    const matchingScheme = (handle: string): string | undefined =>
      DEFAULT_HANDLE_RESOLVERS.find((resolver) => resolver.matches(handle))?.scheme;

    expect(DEFAULT_HANDLE_RESOLVERS.map((resolver) => resolver.scheme)).toEqual([
      'ens',
      'atproto',
      'dns',
      'nip05',
    ]);
    expect(matchingScheme('vitalik.eth')).toBe('ens');
    expect(matchingScheme('example.com')).toBe('atproto');
    expect(matchingScheme('dns:example.com')).toBe('dns');
    expect(matchingScheme('alice')).toBe('nip05');
  });

  it('uses the first matching resolver and does not evaluate later resolvers', async () => {
    const calls: string[] = [];
    const first: HandleResolver = {
      scheme: 'dns',
      matches: () => true,
      resolve: async () => {
        calls.push('first');
        return ok({ did: 'did:web:first.example' });
      },
    };
    const second: HandleResolver = {
      scheme: 'atproto',
      matches: () => true,
      resolve: async () => {
        calls.push('second');
        return ok({ did: 'did:plc:second' });
      },
    };

    const result = await resolveHandle('alice.example', [first, second], unusedIo);

    expect(result).toEqual({ ok: true, value: { did: 'did:web:first.example' } });
    expect(calls).toEqual(['first']);
  });

  it('turns a matching resolver rejection into an unreachable Result', async () => {
    const rejecting: HandleResolver = {
      scheme: 'dns',
      matches: () => true,
      resolve: async () => {
        throw new Error('socket closed');
      },
    };

    const result = await resolveHandle('alice.example', [rejecting], unusedIo);

    expect(result).toEqual({ ok: false, error: 'unreachable' });
  });

  it('returns unsupportedHandle when no registered resolver matches', async () => {
    const result = await resolveHandle('alice.example', [], unusedIo);

    expect(result).toEqual({ ok: false, error: 'unsupportedHandle' });
  });

  it('does not let a broken matches implementation escape as a throw', async () => {
    const broken: HandleResolver = {
      scheme: 'ens',
      matches: () => {
        throw new Error('bad matcher');
      },
      resolve: async () => ok({ did: 'did:pkh:unused' }),
    };

    const result = await resolveHandle('alice.example', [broken], unusedIo);

    expect(result).toEqual({ ok: false, error: 'unsupportedHandle' });
  });

  it('uses a scheme hint to select an ambiguous syntactic resolver without probing another', async () => {
    const calls: string[] = [];
    const atproto: HandleResolver = {
      scheme: 'atproto',
      matches: () => true,
      resolve: async () => {
        calls.push('atproto');
        return ok({ did: 'did:plc:atproto' });
      },
    };
    const dns: HandleResolver = {
      scheme: 'dns',
      matches: () => true,
      resolve: async () => {
        calls.push('dns');
        return ok({ did: 'did:key:dns' });
      },
    };

    const result = await resolveHandle('example.com', [atproto, dns], unusedIo, {
      schemeHint: 'dns',
    });

    expect(result).toEqual({ ok: true, value: { did: 'did:key:dns' } });
    expect(calls).toEqual(['dns']);
  });

  it('applies the DNS scheme hint to the default registry for a bare domain', async () => {
    const queries: string[] = [];
    const io: ResolverIO = {
      dnsTxt: async (name) => {
        queries.push(name);
        return ok(['did:example:alice']);
      },
      fetchText: async () => ok(null),
    };

    const result = await resolveHandle('example.com', DEFAULT_HANDLE_RESOLVERS, io, {
      schemeHint: 'dns',
    });

    expect(result).toEqual({ ok: true, value: { did: 'did:example:alice', sources: [] } });
    expect(queries).toEqual(['_did.example.com']);
  });
});

describe('Nip05HandleResolver', () => {
  it('resolves an active Solidarity name to its exact Nostr profile source', async () => {
    const pubkey = '7e7e9c42a91bfef19fa929e5fda1b72e0ebc1a4c1141673e2794234d86addf4e';
    const npub = 'npub10elfcs4fr0l0r8af98jlmgdh9c8tcxjvz9qkw038js35mp4dma8qzvjptg';
    const calls: string[] = [];
    const io: ResolverIO = {
      dnsTxt: async () => ok([]),
      fetchText: async (url) => {
        calls.push(url);
        if (url.includes('/.well-known/nostr.json')) {
          return ok(JSON.stringify({
            names: { alice: pubkey },
            relays: { [pubkey]: ['wss://relay.example'] },
          }));
        }
        return ok(JSON.stringify({
          name: 'alice',
          status: 'active',
          redirectTo: null,
          redirectUntil: null,
          rebindGeneration: 0,
          reboundAt: null,
        }));
      },
    };

    const result = await new Nip05HandleResolver().resolve('Alice', io);

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'nip05',
        status: 'active',
        name: 'alice',
        identifier: 'alice@solidarity.gg',
        pubkey,
        npub,
        relays: ['wss://relay.example'],
        sources: [{ kind: 'nostr', npub }],
        rebindGeneration: 0,
        reboundAt: null,
      },
    });
    expect(calls.sort()).toEqual([
      'https://solidarity.gg/.well-known/nostr.json?name=alice',
      'https://solidarity.gg/id/history?name=alice',
    ]);
  });

  it('returns a live old-name redirect without trusting a stale directory entry', async () => {
    const io: ResolverIO = {
      dnsTxt: async () => ok([]),
      fetchText: async (url) =>
        url.includes('/.well-known/nostr.json')
          ? ok(JSON.stringify({ names: { alice: '00'.repeat(32) } }))
          : ok(JSON.stringify({
              name: 'alice',
              status: 'redirected',
              redirectTo: 'alice2',
              redirectUntil: 2_000_000_000,
              rebindGeneration: 0,
              reboundAt: null,
            })),
    };

    const result = await new Nip05HandleResolver().resolve('alice', io);

    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'nip05',
        status: 'redirected',
        name: 'alice',
        identifier: 'alice@solidarity.gg',
        redirectTo: 'alice2',
        redirectUntil: 2_000_000_000,
        rebindGeneration: 0,
        reboundAt: null,
      },
    });
  });
});

describe('AtprotoHandleResolver', () => {
  it('resolves a valid handle from DNS TXT before attempting well-known HTTPS', async () => {
    const testCase = vectors.valid[0]!;
    const calls: string[] = [];
    const io: ResolverIO = {
      dnsTxt: async (name) => {
        calls.push(`dns:${name}`);
        return ok(testCase.dnsTxt);
      },
      fetchText: async (url) => {
        calls.push(`fetch:${url}`);
        return ok(null);
      },
    };

    const result = await new AtprotoHandleResolver().resolve(testCase.handle, io);

    expect(result).toEqual({ ok: true, value: { did: testCase.expectedDid } });
    expect(calls).toEqual([`dns:_atproto.${testCase.normalizedHandle}`]);
  });

  it('falls back to the handle HTTPS well-known endpoint when DNS has no DID', async () => {
    const testCase = vectors.valid[1]!;
    const calls: string[] = [];
    const io: ResolverIO = {
      dnsTxt: async (name) => {
        calls.push(`dns:${name}`);
        return ok(testCase.dnsTxt);
      },
      fetchText: async (url) => {
        calls.push(`fetch:${url}`);
        return ok(testCase.wellKnown);
      },
    };

    const result = await new AtprotoHandleResolver().resolve(testCase.handle, io);

    expect(result).toEqual({ ok: true, value: { did: testCase.expectedDid } });
    expect(calls).toEqual([
      `dns:_atproto.${testCase.normalizedHandle}`,
      `fetch:https://${testCase.normalizedHandle}/.well-known/atproto-did`,
    ]);
  });

  it('returns unreachable when DNS failed and well-known cannot establish absence', async () => {
    const io: ResolverIO = {
      dnsTxt: async () => err('unreachable'),
      fetchText: async () => ok(null),
    };

    const result = await new AtprotoHandleResolver().resolve('alice.example', io);

    expect(result).toEqual({ ok: false, error: 'unreachable' });
  });

  it('rejects an HTTP endpoint in DNS instead of fetching or accepting it as a DID', async () => {
    const testCase = vectors.invalid[0]!;
    let fetchCalls = 0;
    const io: ResolverIO = {
      dnsTxt: async () => ok(testCase.dnsTxt),
      fetchText: async () => {
        fetchCalls += 1;
        return ok(testCase.wellKnown);
      },
    };

    const result = await new AtprotoHandleResolver().resolve(testCase.handle, io);

    expect(result).toEqual({ ok: false, error: testCase.expectedError });
    expect(fetchCalls).toBe(0);
  });

  for (const testCase of vectors.invalid.slice(1)) {
    it(`${testCase.name}: rejects invalid handle syntax before IO`, async () => {
      let ioCalls = 0;
      const io: ResolverIO = {
        dnsTxt: async () => {
          ioCalls += 1;
          return ok([]);
        },
        fetchText: async () => {
          ioCalls += 1;
          return ok(null);
        },
      };

      const result = await new AtprotoHandleResolver().resolve(testCase.handle, io);

      expect(result).toEqual({ ok: false, error: testCase.expectedError });
      expect(ioCalls).toBe(0);
    });
  }
});
