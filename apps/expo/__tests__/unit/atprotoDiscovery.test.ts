/**
 * atproto OAuth — identity + server discovery (task A6.1).
 *
 * TS module under test: apps/expo/src/atproto/discovery.ts
 *
 * All HTTP is mocked via the module's `fetchImpl` injection seam — this
 * suite never hits real Bluesky/Cloudflare/PLC infra.
 */
import { describe, expect, it } from 'bun:test';

import {
  discoverAuthServerMetadata,
  extractPdsEndpoint,
  resolveAtprotoIdentity,
  resolveDidDocument,
  resolveHandleToDid,
  verifyHandleReciprocation,
  type AtprotoDidDocument,
} from '@/atproto/discovery';

interface Handler {
  readonly match: (url: string) => boolean;
  readonly respond: (url: string) => Response;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeFetch(handlers: readonly Handler[]): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = urlOf(input);
    const handler = handlers.find((h) => h.match(url));
    if (!handler) throw new Error(`unmocked fetch: ${url}`);
    return Promise.resolve(handler.respond(url));
  }) as typeof fetch;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}

const HANDLE = 'alice.bsky.social';
const DID = 'did:plc:examplefakedid1234';
const PDS_URL = 'https://pds.example.social';

const DID_DOC: AtprotoDidDocument = {
  id: DID,
  alsoKnownAs: [`at://${HANDLE}`],
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS_URL }],
};

function dnsAnswer(did: string): Response {
  return json({ Answer: [{ name: `_atproto.${HANDLE}.`, type: 16, data: `"did=${did}"` }] });
}

// ── resolveHandleToDid ───────────────────────────────────────────────────

describe('resolveHandleToDid', () => {
  it('resolves via DNS TXT (DoH) when the record is present', async () => {
    const fetchImpl = makeFetch([
      { match: (u) => u.includes('dns-query'), respond: () => dnsAnswer(DID) },
    ]);
    const r = await resolveHandleToDid(HANDLE, fetchImpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(DID);
  });

  it('falls back to HTTPS well-known when DNS has no answer', async () => {
    const fetchImpl = makeFetch([
      { match: (u) => u.includes('dns-query'), respond: () => json({ Answer: [] }) },
      { match: (u) => u.endsWith('/.well-known/atproto-did'), respond: () => text(DID) },
    ]);
    const r = await resolveHandleToDid(HANDLE, fetchImpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toBe(DID);
  });

  it('falls back to well-known when the DNS request itself fails (network error)', async () => {
    const fetchImpl = makeFetch([
      {
        match: (u) => u.includes('dns-query'),
        respond: () => {
          throw new Error('network down');
        },
      },
      { match: (u) => u.endsWith('/.well-known/atproto-did'), respond: () => text(DID) },
    ]);
    const r = await resolveHandleToDid(HANDLE, fetchImpl);
    expect(r.ok).toBe(true);
  });

  it('returns err when both DNS and well-known fail to resolve a DID', async () => {
    const fetchImpl = makeFetch([
      { match: (u) => u.includes('dns-query'), respond: () => json({ Answer: [] }) },
      { match: () => true, respond: () => notFound() },
    ]);
    const r = await resolveHandleToDid(HANDLE, fetchImpl);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain(HANDLE);
  });

  it('returns err on an empty handle', async () => {
    const r = await resolveHandleToDid('   ', makeFetch([]));
    expect(r.ok).toBe(false);
  });

  it('rejects a resolved value that is not a well-formed DID', async () => {
    const fetchImpl = makeFetch([{ match: (u) => u.includes('dns-query'), respond: () => dnsAnswer('not-a-did') }]);
    const r = await resolveHandleToDid(HANDLE, fetchImpl);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('malformed');
  });

  it('normalizes handle case before resolution', async () => {
    let queriedName = '';
    const fetchImpl = makeFetch([
      {
        match: (u) => u.includes('dns-query'),
        respond: (u) => {
          queriedName = u;
          return dnsAnswer(DID);
        },
      },
    ]);
    await resolveHandleToDid('Alice.BSKY.Social', fetchImpl);
    expect(queriedName).toContain('_atproto.alice.bsky.social');
  });
});

// ── resolveHandleToDid — handle syntax validation (finding 1) ─────────────
//
// `resolveHandleViaWellKnown` builds `https://${handle}/.well-known/atproto-did`
// from the handle verbatim. A handle like `alice.bsky.social@evil.tld` makes
// `evil.tld` the actual fetch host (with `alice.bsky.social` swallowed as URL
// userinfo) — an attacker controlling evil.tld can hijack the flow. Every
// syntactically-invalid handle MUST be rejected BEFORE any network call.

describe('resolveHandleToDid — handle syntax validation (host-confusion defense)', () => {
  const invalidHandles: readonly string[] = [
    'alice.bsky.social@evil.tld',
    'a/b.com',
    'a b.com',
    'a:80.com',
    '',
    '   ',
    `${'a'.repeat(250)}.com`, // > 253 chars total
  ];

  for (const bad of invalidHandles) {
    it(`rejects ${JSON.stringify(bad)} without ever calling fetch`, async () => {
      let calls = 0;
      const fetchImpl = ((..._args: unknown[]) => {
        calls += 1;
        throw new Error('fetch must not be called for a syntactically invalid handle');
      }) as unknown as typeof fetch;
      const r = await resolveHandleToDid(bad, fetchImpl);
      expect(r.ok).toBe(false);
      expect(calls).toBe(0);
    });
  }

  const validHandles: readonly string[] = ['alice.bsky.social', 'my-domain.com'];

  for (const good of validHandles) {
    it(`accepts syntactically valid handle ${JSON.stringify(good)}`, async () => {
      const fetchImpl = makeFetch([{ match: (u) => u.includes('dns-query'), respond: () => dnsAnswer(DID) }]);
      const r = await resolveHandleToDid(good, fetchImpl);
      expect(r.ok).toBe(true);
    });
  }
});

// ── resolveDidDocument ───────────────────────────────────────────────────

describe('resolveDidDocument', () => {
  it('resolves did:plc via plc.directory', async () => {
    const fetchImpl = makeFetch([{ match: (u) => u.startsWith('https://plc.directory/'), respond: () => json(DID_DOC) }]);
    const r = await resolveDidDocument(DID, fetchImpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual(DID_DOC);
  });

  it('resolves did:web via the domain well-known did.json', async () => {
    const fetchImpl = makeFetch([
      { match: (u) => u === 'https://example.com/.well-known/did.json', respond: () => json(DID_DOC) },
    ]);
    const r = await resolveDidDocument('did:web:example.com', fetchImpl);
    expect(r.ok).toBe(true);
  });

  it('rejects did:web with a path component', async () => {
    const r = await resolveDidDocument('did:web:example.com:path:to:thing', makeFetch([]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('path');
  });

  it('rejects an unsupported DID method', async () => {
    const r = await resolveDidDocument('did:key:z6Mk...', makeFetch([]));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('unsupported');
  });

  it('rejects a malformed DID document (missing service[])', async () => {
    const fetchImpl = makeFetch([
      { match: () => true, respond: () => json({ id: DID, alsoKnownAs: [] }) },
    ]);
    const r = await resolveDidDocument(DID, fetchImpl);
    expect(r.ok).toBe(false);
  });

  it('propagates an HTTP error', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => notFound() }]);
    const r = await resolveDidDocument(DID, fetchImpl);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('404');
  });
});

// ── verifyHandleReciprocation / extractPdsEndpoint (pure) ─────────────────

describe('verifyHandleReciprocation', () => {
  it('true when alsoKnownAs contains at://<handle>', () => {
    expect(verifyHandleReciprocation(DID_DOC, HANDLE)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(verifyHandleReciprocation(DID_DOC, 'Alice.BSKY.Social')).toBe(true);
  });

  it('false when alsoKnownAs claims a different handle', () => {
    const doc: AtprotoDidDocument = { ...DID_DOC, alsoKnownAs: ['at://someone-else.bsky.social'] };
    expect(verifyHandleReciprocation(doc, HANDLE)).toBe(false);
  });

  it('false when alsoKnownAs is empty', () => {
    expect(verifyHandleReciprocation({ ...DID_DOC, alsoKnownAs: [] }, HANDLE)).toBe(false);
  });
});

describe('extractPdsEndpoint', () => {
  it('finds the service by id #atproto_pds', () => {
    const r = extractPdsEndpoint(DID_DOC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(PDS_URL);
  });

  it('finds the service by type AtprotoPersonalDataServer when id differs', () => {
    const doc: AtprotoDidDocument = {
      ...DID_DOC,
      service: [{ id: '#somethingElse', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS_URL }],
    };
    const r = extractPdsEndpoint(doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(PDS_URL);
  });

  it('errs when no PDS service entry exists', () => {
    const r = extractPdsEndpoint({ ...DID_DOC, service: [] });
    expect(r.ok).toBe(false);
  });

  // ── finding 2: https-only on the discovered PDS serviceEndpoint ─────────

  it('rejects a non-https serviceEndpoint', () => {
    const doc: AtprotoDidDocument = {
      ...DID_DOC,
      service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'http://pds.example.social' }],
    };
    const r = extractPdsEndpoint(doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('https');
  });

  it('accepts an https serviceEndpoint', () => {
    const r = extractPdsEndpoint(DID_DOC);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(PDS_URL);
  });
});

// ── resolveAtprotoIdentity (orchestrator) ──────────────────────────────────

describe('resolveAtprotoIdentity', () => {
  it('happy path: handle -> did -> doc -> reciprocation -> pdsUrl', async () => {
    const fetchImpl = makeFetch([
      { match: (u) => u.includes('dns-query'), respond: () => dnsAnswer(DID) },
      { match: (u) => u.startsWith('https://plc.directory/'), respond: () => json(DID_DOC) },
    ]);
    const r = await resolveAtprotoIdentity(HANDLE, fetchImpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ did: DID, handle: HANDLE, pdsUrl: PDS_URL });
  });

  it('fails closed when the DID document does not reciprocate the handle (hijack/stale-DNS defense)', async () => {
    const mismatchedDoc: AtprotoDidDocument = { ...DID_DOC, alsoKnownAs: ['at://not-alice.bsky.social'] };
    const fetchImpl = makeFetch([
      { match: (u) => u.includes('dns-query'), respond: () => dnsAnswer(DID) },
      { match: (u) => u.startsWith('https://plc.directory/'), respond: () => json(mismatchedDoc) },
    ]);
    const r = await resolveAtprotoIdentity(HANDLE, fetchImpl);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('bidirectional');
  });

  it('propagates a handle-resolution failure', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => notFound() }]);
    const r = await resolveAtprotoIdentity(HANDLE, fetchImpl);
    expect(r.ok).toBe(false);
  });

  it('propagates a missing-PDS-service failure even when reciprocation holds', async () => {
    const noServiceDoc: AtprotoDidDocument = { ...DID_DOC, service: [] };
    const fetchImpl = makeFetch([
      { match: (u) => u.includes('dns-query'), respond: () => dnsAnswer(DID) },
      { match: (u) => u.startsWith('https://plc.directory/'), respond: () => json(noServiceDoc) },
    ]);
    const r = await resolveAtprotoIdentity(HANDLE, fetchImpl);
    expect(r.ok).toBe(false);
  });
});

// ── discoverAuthServerMetadata ──────────────────────────────────────────

const AS_ORIGIN = 'https://auth.example.social';

function validAsMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    issuer: AS_ORIGIN,
    authorization_endpoint: `${AS_ORIGIN}/oauth/authorize`,
    token_endpoint: `${AS_ORIGIN}/oauth/token`,
    pushed_authorization_request_endpoint: `${AS_ORIGIN}/oauth/par`,
    require_pushed_authorization_requests: true,
    dpop_signing_alg_values_supported: ['ES256'],
    code_challenge_methods_supported: ['S256'],
    ...overrides,
  };
}

describe('discoverAuthServerMetadata', () => {
  function mockedFetch(asMetadata: Record<string, unknown>): typeof fetch {
    return makeFetch([
      {
        match: (u) => u.endsWith('/.well-known/oauth-protected-resource'),
        respond: () => json({ authorization_servers: [AS_ORIGIN] }),
      },
      {
        match: (u) => u.endsWith('/.well-known/oauth-authorization-server'),
        respond: () => json(asMetadata),
      },
    ]);
  }

  it('happy path returns the validated metadata', async () => {
    const r = await discoverAuthServerMetadata(PDS_URL, mockedFetch(validAsMetadata()));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      issuer: AS_ORIGIN,
      authorizationEndpoint: `${AS_ORIGIN}/oauth/authorize`,
      tokenEndpoint: `${AS_ORIGIN}/oauth/token`,
      pushedAuthorizationRequestEndpoint: `${AS_ORIGIN}/oauth/par`,
    });
  });

  it('errs when protected-resource metadata has no authorization_servers', async () => {
    const fetchImpl = makeFetch([
      { match: (u) => u.endsWith('/.well-known/oauth-protected-resource'), respond: () => json({}) },
    ]);
    const r = await discoverAuthServerMetadata(PDS_URL, fetchImpl);
    expect(r.ok).toBe(false);
  });

  it('errs when pushed_authorization_request_endpoint is missing', async () => {
    const { pushed_authorization_request_endpoint: _drop, ...rest } = validAsMetadata();
    const r = await discoverAuthServerMetadata(PDS_URL, mockedFetch(rest));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('pushed_authorization_request_endpoint');
  });

  it('errs when require_pushed_authorization_requests is not exactly true', async () => {
    const r = await discoverAuthServerMetadata(
      PDS_URL,
      mockedFetch(validAsMetadata({ require_pushed_authorization_requests: false }))
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('PAR');
  });

  it('errs when issuer does not match its own origin (RFC 8414 §3.3)', async () => {
    const r = await discoverAuthServerMetadata(PDS_URL, mockedFetch(validAsMetadata({ issuer: 'https://evil.example' })));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('issuer');
  });

  it('errs when dpop_signing_alg_values_supported does not include ES256', async () => {
    const r = await discoverAuthServerMetadata(
      PDS_URL,
      mockedFetch(validAsMetadata({ dpop_signing_alg_values_supported: ['RS256'] }))
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('ES256');
  });

  it('errs when code_challenge_methods_supported does not include S256', async () => {
    const r = await discoverAuthServerMetadata(
      PDS_URL,
      mockedFetch(validAsMetadata({ code_challenge_methods_supported: ['plain'] }))
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('S256');
  });

  // ── finding 2: https-only on the discovered authorization_servers[0] ────

  it('rejects a non-https authorization_servers[0]', async () => {
    const fetchImpl = makeFetch([
      {
        match: (u) => u.endsWith('/.well-known/oauth-protected-resource'),
        respond: () => json({ authorization_servers: ['http://auth.example.social'] }),
      },
    ]);
    const r = await discoverAuthServerMetadata(PDS_URL, fetchImpl);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('https');
  });

  // ── finding 2 round 2: https-only on the AS metadata's own OAuth
  // endpoints — `postWithDpop` (oauth.ts) POSTs the PKCE code_verifier,
  // authorization code, refresh token, and DPoP proof to these; a
  // non-https endpoint here leaks that body in cleartext even though the
  // PDS serviceEndpoint and authorization_servers[0] origin are already
  // https-validated above. ─────────────────────────────────────────────

  it('rejects a non-https token_endpoint', async () => {
    const r = await discoverAuthServerMetadata(
      PDS_URL,
      mockedFetch(validAsMetadata({ token_endpoint: 'http://auth.example.social/oauth/token' }))
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('https');
    expect(r.error).toContain('token_endpoint');
  });

  it('rejects a non-https pushed_authorization_request_endpoint', async () => {
    const r = await discoverAuthServerMetadata(
      PDS_URL,
      mockedFetch(validAsMetadata({ pushed_authorization_request_endpoint: 'http://auth.example.social/oauth/par' }))
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('https');
    expect(r.error).toContain('pushed_authorization_request_endpoint');
  });

  it('rejects a non-https authorization_endpoint', async () => {
    const r = await discoverAuthServerMetadata(
      PDS_URL,
      mockedFetch(validAsMetadata({ authorization_endpoint: 'http://auth.example.social/oauth/authorize' }))
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('https');
    expect(r.error).toContain('authorization_endpoint');
  });

  it('accepts all-https metadata (happy path re-confirmed with the stricter checks)', async () => {
    const r = await discoverAuthServerMetadata(PDS_URL, mockedFetch(validAsMetadata()));
    expect(r.ok).toBe(true);
  });
});
