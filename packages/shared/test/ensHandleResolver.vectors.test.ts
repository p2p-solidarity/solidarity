import { describe, expect, it } from 'bun:test';

import { ENS_REGISTRY_ADDRESS, EnsHandleResolver, ensNamehash, type ResolverIO } from '../src';
import { ok } from '../src/types/result';
import vectors from '../vectors/ens-handle.json';

const unusedHttpIo = {
  dnsTxt: async () => ok([]),
  fetchText: async () => ok(null),
} satisfies ResolverIO;

describe('EnsHandleResolver conformance vectors', () => {
  it('matches normalized .eth names and rejects invalid labels/non-ENS domains', () => {
    const resolver = new EnsHandleResolver();
    expect(resolver.matches('Vitalik.ETH')).toBe(true);
    expect(resolver.matches('sub.alice.eth')).toBe(true);
    expect(resolver.matches('-alice.eth')).toBe(false);
    expect(resolver.matches('alice..eth')).toBe(false);
    expect(resolver.matches('ens: vitalik.eth')).toBe(false);
    expect(resolver.matches('ens:ens:vitalik.eth')).toBe(false);
    expect(resolver.matches('alice.example')).toBe(false);
  });

  it('matches the published vitalik.eth namehash vector', () => {
    expect(ensNamehash(vectors.namehash.name)).toEqual({
      ok: true,
      value: vectors.namehash.expected,
    });
    expect(ensNamehash('ens: vitalik.eth')).toEqual({ ok: false, error: 'invalidHandle' });
    expect(ensNamehash('ens:ens:vitalik.eth')).toEqual({ ok: false, error: 'invalidHandle' });
  });

  it('resolves the primary org.solidarity.did text record and decodes its ABI string', async () => {
    const calls: { readonly to: string; readonly data: string }[] = [];
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async (to, data) => {
        calls.push({ to, data });
        return ok(calls.length === 1 ? vectors.resolverResponse : vectors.pointerResponse);
      },
    };

    const result = await new EnsHandleResolver().resolve('Vitalik.ETH', io);

    expect(result).toEqual({
      ok: true,
      value: {
        did: vectors.expectedDid,
        sources: [{ kind: 'nostr', npub: vectors.expectedNpub }],
      },
    });
    expect(calls[0]?.to).toBe(ENS_REGISTRY_ADDRESS);
    expect(calls[0]?.data).toBe(`0x0178b8bf${vectors.namehash.expected.slice(2)}`);
    expect(calls[1]?.to).toBe(vectors.resolverAddress);
    expect(calls[1]?.data.startsWith(`0x59d1d43c${vectors.namehash.expected.slice(2)}`)).toBe(true);
  });

  it('falls back from an empty org.solidarity.did value to the legacy did key', async () => {
    const textCallData: string[] = [];
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async (_to, data) => {
        if (data.startsWith('0x0178b8bf')) return ok(vectors.resolverResponse);
        textCallData.push(data);
        return ok(textCallData.length === 1 ? vectors.emptyTextResponse : vectors.pointerResponse);
      },
    };

    const result = await new EnsHandleResolver().resolve('vitalik.eth', io);

    expect(result.ok).toBe(true);
    expect(textCallData).toHaveLength(2);
  });

  it('returns notFound for the zero resolver address (ENSIP-10 is out of scope)', async () => {
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async () => ok(vectors.zeroResolverResponse),
    };

    expect(await new EnsHandleResolver().resolve('vitalik.eth', io)).toEqual({
      ok: false,
      error: 'notFound',
    });
  });

  it('treats non-canonical address padding as unreachable, never as a zero resolver', async () => {
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async () => ok(`0x${'ff'.repeat(12)}${'00'.repeat(20)}`),
    };

    expect(await new EnsHandleResolver().resolve('vitalik.eth', io)).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('treats partial-invalid hex as unreachable, never as a zero resolver', async () => {
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async () => ok(`0x${'00'.repeat(31)}0g`),
    };

    expect(await new EnsHandleResolver().resolve('vitalik.eth', io)).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('treats a non-canonical zero text offset as unreachable, not record removal', async () => {
    let calls = 0;
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async () => {
        calls += 1;
        return ok(calls === 1 ? vectors.resolverResponse : `0x${'00'.repeat(64)}`);
      },
    };

    expect(await new EnsHandleResolver().resolve('vitalik.eth', io)).toEqual({
      ok: false,
      error: 'unreachable',
    });
    expect(calls).toBe(2);
  });

  it('returns unreachable when the optional ethCall dependency is absent', async () => {
    expect(await new EnsHandleResolver().resolve('vitalik.eth', unusedHttpIo)).toEqual({
      ok: false,
      error: 'unreachable',
    });
  });

  it('rejects invalid names before any RPC call', async () => {
    let calls = 0;
    const io: ResolverIO = {
      ...unusedHttpIo,
      ethCall: async () => {
        calls += 1;
        return ok(vectors.zeroResolverResponse);
      },
    };

    for (const handle of ['alice..eth', 'ens: vitalik.eth', 'ens:ens:vitalik.eth']) {
      expect(await new EnsHandleResolver().resolve(handle, io)).toEqual({
        ok: false,
        error: 'invalidHandle',
      });
    }
    expect(calls).toBe(0);
  });
});
