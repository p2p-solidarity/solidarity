import { describe, expect, it } from 'bun:test';

import { DnsHandleResolver, type ResolverIO, type ResolverIoError } from '../src';
import { err, ok } from '../src/types/result';
import vectors from '../vectors/dns-handle.json';

interface DnsCase {
  readonly name: string;
  readonly handle: string;
  readonly dnsTxt?: readonly string[];
  readonly dnsError?: ResolverIoError;
  readonly wellKnown?: string | null;
  readonly expectedDid: string;
  readonly expectedSources: readonly { readonly kind: 'nostr'; readonly npub: string }[];
}

const cases = vectors.cases as readonly DnsCase[];

describe('DnsHandleResolver conformance vectors', () => {
  for (const testCase of cases) {
    it(`${testCase.name}: resolves a DNS handle`, async () => {
      const calls: string[] = [];
      const io: ResolverIO = {
        dnsTxt: async (name) => {
          calls.push(`dns:${name}`);
          return testCase.dnsError === undefined
            ? ok(testCase.dnsTxt ?? [])
            : err(testCase.dnsError);
        },
        fetchText: async (url) => {
          calls.push(`fetch:${url}`);
          return ok(testCase.wellKnown ?? null);
        },
      };

      const result = await new DnsHandleResolver().resolve(testCase.handle, io);

      expect(result).toEqual({
        ok: true,
        value: {
          did: testCase.expectedDid,
          sources: testCase.expectedSources,
        },
      });
      expect(calls[0]).toBe('dns:_did.example.com');
      if (testCase.dnsTxt === undefined) {
        expect(calls[1]).toBe('fetch:https://example.com/.well-known/did');
      }
    });
  }

  it('matches valid bare/prefixed domains but excludes .eth and invalid hostnames', () => {
    const resolver = new DnsHandleResolver();
    expect(resolver.matches('example.com')).toBe(true);
    expect(resolver.matches('dns:Example.COM')).toBe(true);
    expect(resolver.matches('alice.eth')).toBe(false);
    expect(resolver.matches('localhost')).toBe(false);
    expect(resolver.matches('@example.com')).toBe(false);
    expect(resolver.matches('dns:@example.com')).toBe(false);
    expect(resolver.matches('dns: @example.com')).toBe(false);
    expect(resolver.matches('dns: example.com')).toBe(false);
    expect(resolver.matches('alice.example@attacker.test')).toBe(false);
  });

  it('rejects malformed TXT instead of hiding it behind well-known fallback', async () => {
    let fetchCalls = 0;
    const io: ResolverIO = {
      dnsTxt: async () => ok(['did=', 'junk=value']),
      fetchText: async () => {
        fetchCalls += 1;
        return ok(vectors.referenceDid);
      },
    };

    expect(await new DnsHandleResolver().resolve('dns:example.com', io)).toEqual({
      ok: false,
      error: 'malformedDid',
    });
    expect(fetchCalls).toBe(0);
  });

  it('rejects prefix-whitespace and double-prefix inputs before any IO', async () => {
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

    for (const handle of ['dns: example.com', 'dns: @example.com', 'dns:dns:example.com']) {
      expect(await new DnsHandleResolver().resolve(handle, io)).toEqual({
        ok: false,
        error: 'invalidHandle',
      });
    }
    expect(ioCalls).toBe(0);
  });

  it('rejects conflicting parseable TXT records', async () => {
    const io: ResolverIO = {
      dnsTxt: async () =>
        ok([
          `did=${vectors.referenceDid}`,
          'did=did:key:zDnaeaQHQpDWivip1SugnEwZaF5JUCmSyPrYewToLKYmv8CyV',
        ]),
      fetchText: async () => ok(null),
    };

    expect(await new DnsHandleResolver().resolve('dns:example.com', io)).toEqual({
      ok: false,
      error: 'conflictingRecords',
    });
  });

  it('does not call an HTTP well-known endpoint and propagates insecureEndpoint', async () => {
    const seenUrls: string[] = [];
    const io: ResolverIO = {
      dnsTxt: async () => err('notFound'),
      fetchText: async (url) => {
        seenUrls.push(url);
        return err('insecureEndpoint');
      },
    };

    expect(await new DnsHandleResolver().resolve('dns:example.com', io)).toEqual({
      ok: false,
      error: 'insecureEndpoint',
    });
    expect(seenUrls).toEqual(['https://example.com/.well-known/did']);
  });

  it('returns unreachable when DNS was unreachable and HTTPS only establishes absence', async () => {
    const io: ResolverIO = {
      dnsTxt: async () => err('unreachable'),
      fetchText: async () => err('notFound'),
    };

    expect(await new DnsHandleResolver().resolve('dns:example.com', io)).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('rejects an oversized well-known body', async () => {
    const io: ResolverIO = {
      dnsTxt: async () => err('notFound'),
      fetchText: async () => ok(`did=did:key:${'z'.repeat(5_000)}`),
    };

    expect(await new DnsHandleResolver().resolve('dns:example.com', io)).toEqual({
      ok: false,
      error: 'malformedDid',
    });
  });
});
