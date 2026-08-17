/**
 * IssuerMetadataStore + trust anchor — cache, eviction, fetch.
 *
 * Mirrors the test pattern in groupStore.test.ts / sharingSettingsStore.test.ts:
 * stub `@/storage/mmkv` + `@/storage/encryptionManager` with in-memory shims so
 * the encrypted-blob round-trip is observable without touching native code.
 *
 * Pins:
 *   1. Cache round-trip — upsert → reset zustand → hydrate → same metadata
 *   2. `fetchAndCacheIssuer` with mocked fetch returning valid OID4VCI
 *      issuer metadata + logo bytes stores both
 *   3. `clearStale(maxAge)` evicts entries older than the cutoff
 *   4. `trustsIssuer(did)` returns true for preloaded anchors (parity with
 *      Swift `IssuerTrustAnchorStore.isTrustedIssuer`)
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { IssuerMetadata } from '../../src/credentials/issuerStore';
import type {
  PreloadedTrustAnchor,
} from '../../src/credentials/preloadedTrustAnchors';

const kv = new Map<string, string>();
const preloaded: PreloadedTrustAnchor[] = [];

interface IssuerStoreSurface {
  readonly useIssuerMetadataStore: {
    getState: () => {
      readonly manifest: readonly { readonly did: string; readonly displayName?: string }[];
      readonly entries: Readonly<Record<string, IssuerMetadata>>;
      readonly hydrated: boolean;
      readonly hydrate: () => Promise<void>;
      readonly upsert: (m: IssuerMetadata) => Promise<void>;
      readonly remove: (id: string) => Promise<void>;
      readonly clearStale: (
        maxAgeMs: number,
        now?: Date
      ) => Promise<readonly string[]>;
    };
    setState: (s: Partial<{
      readonly manifest: readonly { readonly did: string; readonly displayName?: string }[];
      readonly entries: Readonly<Record<string, IssuerMetadata>>;
      readonly hydrated: boolean;
    }>) => void;
  };
  readonly fetchAndCacheIssuer: (
    issuerUrl: string,
    opts?: { readonly fetchImpl?: typeof fetch }
  ) => Promise<IssuerMetadata | undefined>;
  readonly __ISSUER_METADATA_STORAGE_KEY: string;
  readonly __ISSUER_METADATA_MAX_LOGO_BYTES: number;
  readonly __resetIssuerMetadataStoreForTesting: () => void;
}

interface TrustAnchorSurface {
  readonly trustsIssuer: (did: string, keyId?: string) => boolean;
}

let issuerMod: IssuerStoreSurface;
let trustMod: TrustAnchorSurface;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => ({
    getMmkv: () => ({
      getString: (k: string): string | undefined => kv.get(k),
      set: (k: string, v: string): void => {
        kv.set(k, v);
      },
      remove: (k: string): void => {
        kv.delete(k);
      },
      getAllKeys: (): readonly string[] => Array.from(kv.keys()),
    }),
    initMmkv: async () => undefined,
  }));
  await mock.module('@/storage/encryptionManager', () => ({
    encryptJson: async (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64'),
    decryptJson: async <T,>(s: string): Promise<T> => {
      const raw = s.startsWith('{') ? s : Buffer.from(s, 'base64').toString('utf8');
      return JSON.parse(raw) as T;
    },
  }));
  await mock.module(
    '@/credentials/preloadedTrustAnchors',
    () => ({
      PRELOADED_TRUST_ANCHORS: preloaded,
    })
  );
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  issuerMod = (await import('../../src/credentials/issuerStore')) as unknown as IssuerStoreSurface;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  trustMod = (await import('../../src/credentials/trustAnchor')) as unknown as TrustAnchorSurface;
});

beforeEach(() => {
  kv.clear();
  preloaded.length = 0;
  issuerMod.__resetIssuerMetadataStoreForTesting();
});

function makeMetadata(overrides: Partial<IssuerMetadata> = {}): IssuerMetadata {
  return {
    id: 'https://issuer.example/',
    displayName: 'Example Issuer',
    description: 'Test issuer',
    logoBase64: 'aGVsbG8=',
    logoMimeType: 'image/png',
    logoUri: 'https://issuer.example/logo.png',
    lastRefreshedAt: new Date('2026-05-01T00:00:00Z'),
    ...overrides,
  };
}

describe('IssuerMetadataStore — cache round-trip', () => {
  it('upsert + reset + hydrate restores the same metadata', async () => {
    const m = makeMetadata();
    await issuerMod.useIssuerMetadataStore.getState().upsert(m);

    expect(kv.has(issuerMod.__ISSUER_METADATA_STORAGE_KEY)).toBe(true);

    // Fresh process simulation
    issuerMod.useIssuerMetadataStore.setState({
      manifest: [],
      entries: {},
      hydrated: false,
    });
    await issuerMod.useIssuerMetadataStore.getState().hydrate();

    const restored = issuerMod.useIssuerMetadataStore.getState().entries[m.id];
    expect(restored).toBeDefined();
    if (!restored) throw new Error('unreachable');
    expect(restored.displayName).toBe('Example Issuer');
    expect(restored.logoBase64).toBe('aGVsbG8=');
    expect(restored.logoMimeType).toBe('image/png');
    expect(restored.lastRefreshedAt instanceof Date).toBe(true);
    expect(restored.lastRefreshedAt.toISOString()).toBe(m.lastRefreshedAt.toISOString());
  });

  it('remove drops the entry and rewrites the persisted blob', async () => {
    const a = makeMetadata({ id: 'https://a.example/' });
    const b = makeMetadata({ id: 'https://b.example/' });
    await issuerMod.useIssuerMetadataStore.getState().upsert(a);
    await issuerMod.useIssuerMetadataStore.getState().upsert(b);

    await issuerMod.useIssuerMetadataStore.getState().remove(a.id);

    const entries = issuerMod.useIssuerMetadataStore.getState().entries;
    expect(Object.keys(entries)).toEqual(['https://b.example/']);

    issuerMod.useIssuerMetadataStore.setState({
      manifest: [],
      entries: {},
      hydrated: false,
    });
    await issuerMod.useIssuerMetadataStore.getState().hydrate();
    expect(
      Object.keys(issuerMod.useIssuerMetadataStore.getState().entries)
    ).toEqual(['https://b.example/']);
  });
});

describe('fetchAndCacheIssuer — well-known parse + logo bytes', () => {
  function makeFetch(
    metadata: unknown,
    logoBytes?: Uint8Array,
    logoContentType = 'image/png'
  ): typeof fetch {
    const impl = (input: RequestInfo | URL, _init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.endsWith('/.well-known/openid-credential-issuer')) {
        return Promise.resolve(
          new Response(JSON.stringify(metadata), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      }
      if (logoBytes) {
        const buf = new ArrayBuffer(logoBytes.byteLength);
        new Uint8Array(buf).set(logoBytes);
        return Promise.resolve(
          new Response(buf, {
            status: 200,
            headers: { 'content-type': logoContentType },
          })
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    };
    return impl as unknown as typeof fetch;
  }

  it('parses display block + downloads logo + persists base64', async () => {
    const logoBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchImpl = makeFetch(
      {
        credential_issuer: 'https://issuer.example',
        display: [
          {
            name: 'Acme University',
            description: 'A test university',
            logo: { uri: 'https://issuer.example/logo.png', alt_text: 'Acme' },
          },
        ],
      },
      logoBytes,
      'image/png'
    );

    const result = await issuerMod.fetchAndCacheIssuer(
      'https://issuer.example',
      { fetchImpl }
    );

    expect(result).toBeDefined();
    if (!result) throw new Error('unreachable');
    expect(result.displayName).toBe('Acme University');
    expect(result.description).toBe('A test university');
    expect(result.logoUri).toBe('https://issuer.example/logo.png');
    expect(result.logoBase64).toBeDefined();
    expect(result.logoMimeType).toBe('image/png');

    // Persisted under the storage key
    expect(kv.has(issuerMod.__ISSUER_METADATA_STORAGE_KEY)).toBe(true);
    const cached = issuerMod.useIssuerMetadataStore.getState().entries[result.id];
    expect(cached?.logoBase64).toBe(result.logoBase64);
  });

  it('rejects oversized logos (> 100 KB) — falls back to no-logo entry', async () => {
    const oversized = new Uint8Array(
      issuerMod.__ISSUER_METADATA_MAX_LOGO_BYTES + 1
    );
    const fetchImpl = makeFetch(
      {
        display: [
          {
            name: 'Big Logo Issuer',
            logo: { uri: 'https://issuer.example/huge.png' },
          },
        ],
      },
      oversized
    );

    const result = await issuerMod.fetchAndCacheIssuer(
      'https://issuer.example',
      { fetchImpl }
    );
    expect(result).toBeDefined();
    if (!result) throw new Error('unreachable');
    expect(result.displayName).toBe('Big Logo Issuer');
    expect(result.logoBase64).toBeUndefined();
    expect(result.logoMimeType).toBeUndefined();
  });

  it('rejects non-HTTPS issuer URLs (returns undefined, no cache write)', async () => {
    const fetchImpl = (() =>
      Promise.resolve(new Response(null, { status: 200 }))) as unknown as typeof fetch;
    const result = await issuerMod.fetchAndCacheIssuer(
      'http://insecure.example/',
      { fetchImpl }
    );
    expect(result).toBeUndefined();
    expect(kv.has(issuerMod.__ISSUER_METADATA_STORAGE_KEY)).toBe(false);
  });

  it('rejects non-HTTPS logo URIs but keeps the display block', async () => {
    const fetchImpl = makeFetch({
      display: [
        {
          name: 'Insecure Logo Issuer',
          logo: { uri: 'http://insecure.example/logo.png' },
        },
      ],
    });
    const result = await issuerMod.fetchAndCacheIssuer(
      'https://issuer.example',
      { fetchImpl }
    );
    expect(result).toBeDefined();
    if (!result) throw new Error('unreachable');
    expect(result.displayName).toBe('Insecure Logo Issuer');
    expect(result.logoUri).toBeUndefined();
    expect(result.logoBase64).toBeUndefined();
  });

  it('falls back to hostname when display block has no name', async () => {
    const fetchImpl = makeFetch({});
    const result = await issuerMod.fetchAndCacheIssuer(
      'https://issuer.example',
      { fetchImpl }
    );
    expect(result?.displayName).toBe('issuer.example');
  });
});

describe('clearStale — eviction by age', () => {
  it('evicts entries older than maxAgeMs and leaves fresh ones intact', async () => {
    const now = new Date('2026-05-24T12:00:00Z');
    const oldEntry = makeMetadata({
      id: 'https://stale.example/',
      lastRefreshedAt: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000),
    });
    const freshEntry = makeMetadata({
      id: 'https://fresh.example/',
      lastRefreshedAt: new Date(now.getTime() - 60 * 1000),
    });
    await issuerMod.useIssuerMetadataStore.getState().upsert(oldEntry);
    await issuerMod.useIssuerMetadataStore.getState().upsert(freshEntry);

    const oneDay = 24 * 60 * 60 * 1000;
    const evicted = await issuerMod.useIssuerMetadataStore
      .getState()
      .clearStale(oneDay, now);

    expect(evicted).toEqual(['https://stale.example/']);
    const remaining = issuerMod.useIssuerMetadataStore.getState().entries;
    expect(Object.keys(remaining)).toEqual(['https://fresh.example/']);
  });

  it('is a no-op when nothing is stale', async () => {
    const now = new Date('2026-05-24T12:00:00Z');
    await issuerMod.useIssuerMetadataStore.getState().upsert(
      makeMetadata({ lastRefreshedAt: now })
    );
    const evicted = await issuerMod.useIssuerMetadataStore
      .getState()
      .clearStale(60_000, now);
    expect(evicted).toEqual([]);
  });
});

describe('trustsIssuer — preloaded anchors (parity with Swift)', () => {
  it('returns true for an issuer DID in PRELOADED_TRUST_ANCHORS', () => {
    preloaded.push({
      issuerDid: 'did:web:trusted.example',
      publicKeyJwk: {
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        y: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
      displayName: 'Trusted Example',
    });

    expect(trustMod.trustsIssuer('did:web:trusted.example')).toBe(true);
    expect(trustMod.trustsIssuer('DID:WEB:TRUSTED.EXAMPLE')).toBe(true);
    expect(trustMod.trustsIssuer('did:web:unknown.example')).toBe(false);
  });

  it('returns false when the preloaded list is empty (production default)', () => {
    expect(trustMod.trustsIssuer('did:web:anything.example')).toBe(false);
  });
});
