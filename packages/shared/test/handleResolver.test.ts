import { describe, expect, it } from 'bun:test';

import { AtprotoHandleResolver, resolveHandle, type HandleResolver, type ResolverIO } from '../src';
import { err, ok } from '../src/types/result';
import vectors from '../vectors/atproto-handle.json';

const unusedIo: ResolverIO = {
  dnsTxt: async () => ok([]),
  fetchText: async () => ok(null),
};

describe('resolveHandle', () => {
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
