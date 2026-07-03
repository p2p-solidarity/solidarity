/**
 * atproto OAuth — orchestration (task A6.1).
 *
 * TS module under test: apps/expo/src/atproto/oauth.ts
 *
 * The interactive browser step is stubbed via `startAtprotoOAuth`'s
 * `browserLauncher` injection seam (never a real ASWebAuthenticationSession
 * — see module doc, "the interactive browser step can't be unit-tested").
 * Every other step (identity resolution, server discovery, PAR, DPoP-nonce
 * retry, token exchange, storage) is exercised against a mocked `fetch` and
 * an in-memory `AtprotoSessionStorage`, so this suite never hits real
 * Bluesky infra.
 *
 * Also pins the `apps/expo/docs/atproto-client-metadata.json` hand-off doc
 * against `clientMetadata.ts`'s `CLIENT_METADATA_DOCUMENT` constant so the
 * two can't silently drift apart.
 */
import { beforeEach, describe, expect, it } from 'bun:test';

import clientMetadataDoc from '../../docs/atproto-client-metadata.json';
import {
  ATPROTO_CLIENT_ID,
  ATPROTO_REDIRECT_URI,
  CLIENT_METADATA_DOCUMENT,
} from '@/atproto/clientMetadata';
import {
  __setAtprotoSessionStorageForTesting,
  type AtprotoSessionStorage,
  type PendingAtprotoFlow,
  type PersistedAtprotoSession,
} from '@/atproto/session';
import {
  getAtprotoSession,
  refreshAtprotoSession,
  signOutAtproto,
  startAtprotoOAuth,
  type AtprotoBrowserLauncher,
} from '@/atproto/oauth';

// ── docs/atproto-client-metadata.json must match the app's own expectation ─

describe('docs/atproto-client-metadata.json', () => {
  it('matches clientMetadata.ts CLIENT_METADATA_DOCUMENT exactly', () => {
    // `CLIENT_METADATA_DOCUMENT`'s array fields are `readonly` (`as const`);
    // round-trip through JSON to compare structurally against the parsed
    // (plain, mutable) JSON file without fighting TS's readonly variance.
    expect(clientMetadataDoc).toEqual(JSON.parse(JSON.stringify(CLIENT_METADATA_DOCUMENT)) as typeof clientMetadataDoc);
  });

  it('client_id is the URL the app requests as client_id', () => {
    expect(clientMetadataDoc.client_id).toBe(ATPROTO_CLIENT_ID);
  });

  it('declares the exact redirect URI oauth.ts uses, single-slash native-scheme form', () => {
    expect(clientMetadataDoc.redirect_uris).toContain(ATPROTO_REDIRECT_URI);
    expect(ATPROTO_REDIRECT_URI).toMatch(/^solidarity:\/[^/]/u);
  });

  it('dpop_bound_access_tokens is true (mandatory for all atproto OAuth clients)', () => {
    expect(clientMetadataDoc.dpop_bound_access_tokens).toBe(true);
  });
});

// ── In-memory session storage double ────────────────────────────────────

let sessionStore: PersistedAtprotoSession | null = null;
let pendingStore: PendingAtprotoFlow | null = null;

const fakeStorage: AtprotoSessionStorage = {
  getSession: () => Promise.resolve(sessionStore),
  setSession: (s) => {
    sessionStore = s;
    return Promise.resolve();
  },
  deleteSession: () => {
    sessionStore = null;
    return Promise.resolve();
  },
  getPendingFlow: () => Promise.resolve(pendingStore),
  setPendingFlow: (f) => {
    pendingStore = f;
    return Promise.resolve();
  },
  deletePendingFlow: () => {
    pendingStore = null;
    return Promise.resolve();
  },
};

// ── Mocked atproto server fixtures ──────────────────────────────────────

const HANDLE = 'alice.bsky.social';
const DID = 'did:plc:examplefakedid1234';
const PDS_URL = 'https://pds.example.social';
const AS_ORIGIN = 'https://auth.example.social';
const PAR_ENDPOINT = `${AS_ORIGIN}/oauth/par`;
const TOKEN_ENDPOINT = `${AS_ORIGIN}/oauth/token`;
const AUTHZ_ENDPOINT = `${AS_ORIGIN}/oauth/authorize`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function text(body: string, status = 200): Response {
  return new Response(body, { status });
}

function dnsAnswer(did: string): Response {
  return json({ Answer: [{ name: `_atproto.${HANDLE}.`, type: 16, data: `"did=${did}"` }] });
}

const DID_DOC = {
  id: DID,
  alsoKnownAs: [`at://${HANDLE}`],
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS_URL }],
};

function asMetadataDoc(): Record<string, unknown> {
  return {
    issuer: AS_ORIGIN,
    authorization_endpoint: AUTHZ_ENDPOINT,
    token_endpoint: TOKEN_ENDPOINT,
    pushed_authorization_request_endpoint: PAR_ENDPOINT,
    require_pushed_authorization_requests: true,
    dpop_signing_alg_values_supported: ['ES256'],
    code_challenge_methods_supported: ['S256'],
  };
}

function tokenResponseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    access_token: 'access-token-value',
    token_type: 'DPoP',
    refresh_token: 'refresh-token-value',
    sub: DID,
    scope: 'atproto transition:generic',
    expires_in: 300,
    ...overrides,
  };
}

/** A DPoP endpoint that requires exactly one nonce-retry round trip before succeeding. */
function makeNonceGatedEndpoint(successBody: () => Record<string, unknown>, nonceValue: string) {
  let calls = 0;
  return (): Response => {
    calls += 1;
    if (calls === 1) {
      return json({ error: 'use_dpop_nonce' }, 400, { 'DPoP-Nonce': nonceValue });
    }
    return json(successBody(), 200, { 'DPoP-Nonce': `${nonceValue}-2` });
  };
}

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

function baseHandlers(opts?: { readonly parRespond?: () => Response; readonly tokenRespond?: () => Response }): Handler[] {
  return [
    { match: (u) => u.includes('dns-query'), respond: () => dnsAnswer(DID) },
    { match: (u) => u.startsWith('https://plc.directory/'), respond: () => json(DID_DOC) },
    { match: (u) => u.endsWith('/.well-known/oauth-protected-resource'), respond: () => json({ authorization_servers: [AS_ORIGIN] }) },
    { match: (u) => u.endsWith('/.well-known/oauth-authorization-server'), respond: () => json(asMetadataDoc()) },
    { match: (u) => u === PAR_ENDPOINT, respond: opts?.parRespond ?? makeNonceGatedEndpoint(() => ({ request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 60 }), 'par-nonce') },
    { match: (u) => u === TOKEN_ENDPOINT, respond: opts?.tokenRespond ?? makeNonceGatedEndpoint(() => tokenResponseBody(), 'token-nonce') },
  ];
}

function successBrowserLauncher(): AtprotoBrowserLauncher {
  return (_authorizeUrl, redirectUri) => {
    const pending = pendingStore;
    if (!pending) throw new Error('test setup error: no pending flow at browser-launch time');
    return Promise.resolve({ type: 'success', url: `${redirectUri}?code=test-code&state=${pending.state}&iss=${AS_ORIGIN}` });
  };
}

beforeEach(() => {
  sessionStore = null;
  pendingStore = null;
  __setAtprotoSessionStorageForTesting(fakeStorage);
});

// ── startAtprotoOAuth — happy path ──────────────────────────────────────

describe('startAtprotoOAuth', () => {
  it('happy path: resolves identity, discovers AS, PARs (with nonce retry), authorizes, exchanges the code, persists the session', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.did).toBe(DID);
    expect(r.value.handle).toBe(HANDLE);
    expect(r.value.pdsUrl).toBe(PDS_URL);
    expect(r.value.authServerIssuer).toBe(AS_ORIGIN);
    expect(r.value.accessToken).toBe('access-token-value');
    expect(r.value.scope).toBe('atproto transition:generic');
    expect(r.value.accessTokenExpiresAtMs).toBeGreaterThan(Date.now());

    // No leaked internal fields in the public shape.
    expect('refreshToken' in r.value).toBe(false);
    expect('dpopPrivateKeyHex' in r.value).toBe(false);

    // Session persisted, pending flow cleared.
    expect(sessionStore?.did).toBe(DID);
    expect(sessionStore?.refreshToken).toBe('refresh-token-value');
    expect(pendingStore).toBeNull();
  });

  it('persists the pending flow BEFORE invoking the browser launcher (survives a killed JS context mid-hop)', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    // A plain mutable-property container (rather than a reassigned `let`
    // primitive) avoids TS narrowing the outer binding to the closure's
    // pre-call type across the async boundary.
    const captured: { did: string | null } = { did: null };
    const browserLauncher: AtprotoBrowserLauncher = (_url, redirectUri) => {
      const pending = pendingStore;
      if (!pending) throw new Error('no pending flow');
      captured.did = pending.expectedDid;
      return Promise.resolve({ type: 'success', url: `${redirectUri}?code=c&state=${pending.state}&iss=${AS_ORIGIN}` });
    };
    await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(captured.did).toBe(DID);
  });

  it('user-cancelled browser session clears the pending flow and returns err', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const browserLauncher: AtprotoBrowserLauncher = () => Promise.resolve({ type: 'cancel' });
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('cancelled');
    expect(pendingStore).toBeNull();
    expect(sessionStore).toBeNull();
  });

  it('rejects a redirect with a mismatched state (CSRF / stale callback defense)', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const browserLauncher: AtprotoBrowserLauncher = (_url, redirectUri) =>
      Promise.resolve({ type: 'success', url: `${redirectUri}?code=c&state=WRONG-STATE&iss=${AS_ORIGIN}` });
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('state mismatch');
    expect(sessionStore).toBeNull();
  });

  it('rejects a redirect with a mismatched iss (refuses to trust an unbound Authorization Server)', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const browserLauncher: AtprotoBrowserLauncher = (_url, redirectUri) => {
      const pending = pendingStore;
      if (!pending) throw new Error('no pending flow');
      return Promise.resolve({ type: 'success', url: `${redirectUri}?code=c&state=${pending.state}&iss=https://evil.example` });
    };
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('iss');
    expect(sessionStore).toBeNull();
  });

  it('rejects a redirect carrying an oauth error param', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const browserLauncher: AtprotoBrowserLauncher = (_url, redirectUri) =>
      Promise.resolve({ type: 'success', url: `${redirectUri}?error=access_denied&error_description=user+declined` });
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('access_denied');
  });

  it('rejects a token response whose sub does not match the resolved identity (DID-confusion defense)', async () => {
    const fetchImpl = makeFetch(
      baseHandlers({ tokenRespond: makeNonceGatedEndpoint(() => tokenResponseBody({ sub: 'did:plc:someoneelse' }), 'token-nonce') })
    );
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('sub');
    expect(sessionStore).toBeNull();
  });

  it('propagates a PAR failure without ever opening the browser', async () => {
    let browserOpened = false;
    const fetchImpl = makeFetch(baseHandlers({ parRespond: () => text('server error', 500) }));
    const browserLauncher: AtprotoBrowserLauncher = () => {
      browserOpened = true;
      return Promise.resolve({ type: 'cancel' });
    };
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(r.ok).toBe(false);
    expect(browserOpened).toBe(false);
  });

  it('propagates an identity-resolution failure before any discovery/PAR call', async () => {
    const fetchImpl = makeFetch([{ match: () => true, respond: () => text('not found', 404) }]);
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(r.ok).toBe(false);
  });

  it('errs if a success browser result carries no url', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const browserLauncher: AtprotoBrowserLauncher = () => Promise.resolve({ type: 'success' });
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher });
    expect(r.ok).toBe(false);
  });

  // ── finding 4: no-throw contract ─────────────────────────────────────────

  it('a storage failure persisting the pending flow returns err(...) rather than rejecting (no-throw contract)', async () => {
    const throwingStorage: AtprotoSessionStorage = {
      ...fakeStorage,
      setPendingFlow: () => {
        throw new Error('secure store locked mid-write');
      },
    };
    __setAtprotoSessionStorageForTesting(throwingStorage);
    const fetchImpl = makeFetch(baseHandlers());
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(r.ok).toBe(false);
  });

  it('a storage failure persisting the completed session returns err(...) rather than rejecting (no-throw contract, completeAtprotoOAuthCallback)', async () => {
    const throwingStorage: AtprotoSessionStorage = {
      ...fakeStorage,
      setSession: () => {
        throw new Error('secure store locked mid-write');
      },
    };
    __setAtprotoSessionStorageForTesting(throwingStorage);
    const fetchImpl = makeFetch(baseHandlers());
    const r = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(r.ok).toBe(false);
  });
});

// ── getAtprotoSession ────────────────────────────────────────────────────

describe('getAtprotoSession', () => {
  it('returns ok(null) when nothing is stored', async () => {
    const r = await getAtprotoSession();
    expect(r).toEqual({ ok: true, value: null });
  });

  it('returns the public-safe session after a successful sign-in, with no refresh token / dpop key leaked', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    const r = await getAtprotoSession();
    expect(r.ok).toBe(true);
    if (!r.ok || !r.value) return;
    expect(r.value.did).toBe(DID);
    expect('refreshToken' in r.value).toBe(false);
  });
});

// ── refreshAtprotoSession ───────────────────────────────────────────────

describe('refreshAtprotoSession', () => {
  it('errs when not signed in', async () => {
    const r = await refreshAtprotoSession({ fetchImpl: makeFetch([]) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('not signed in');
  });

  it('happy path: exchanges the refresh token, replaces it, updates expiry, keeps the same DPoP key', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    const signIn = await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(signIn.ok).toBe(true);
    const dpopKeyBefore = sessionStore?.dpopPrivateKeyHex;

    const refreshHandlers = makeFetch([
      {
        match: (u) => u === TOKEN_ENDPOINT,
        respond: makeNonceGatedEndpoint(
          () => tokenResponseBody({ access_token: 'refreshed-access', refresh_token: 'refreshed-refresh' }),
          'refresh-nonce'
        ),
      },
    ]);
    const r = await refreshAtprotoSession({ fetchImpl: refreshHandlers });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.accessToken).toBe('refreshed-access');
    expect(sessionStore?.refreshToken).toBe('refreshed-refresh');
    expect(sessionStore?.dpopPrivateKeyHex).toBe(dpopKeyBefore);
  });

  it('rejects a refresh response whose sub does not match the signed-in account', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });

    const refreshHandlers = makeFetch([
      {
        match: (u) => u === TOKEN_ENDPOINT,
        respond: makeNonceGatedEndpoint(() => tokenResponseBody({ sub: 'did:plc:someoneelse' }), 'refresh-nonce'),
      },
    ]);
    const r = await refreshAtprotoSession({ fetchImpl: refreshHandlers });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('sub');
  });

  it('a storage failure returns err(...) rather than rejecting (no-throw contract)', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });

    const throwingStorage: AtprotoSessionStorage = {
      ...fakeStorage,
      getSession: () => {
        throw new Error('secure store locked mid-read');
      },
    };
    __setAtprotoSessionStorageForTesting(throwingStorage);
    const r = await refreshAtprotoSession({ fetchImpl: makeFetch([]) });
    expect(r.ok).toBe(false);
  });
});

// ── signOutAtproto ───────────────────────────────────────────────────────

describe('signOutAtproto', () => {
  it('clears both the session and any pending flow, and getAtprotoSession reverts to null', async () => {
    const fetchImpl = makeFetch(baseHandlers());
    await startAtprotoOAuth(HANDLE, { fetchImpl, browserLauncher: successBrowserLauncher() });
    expect(sessionStore).not.toBeNull();

    const r = await signOutAtproto();
    expect(r.ok).toBe(true);
    expect(sessionStore).toBeNull();
    expect(pendingStore).toBeNull();

    const after = await getAtprotoSession();
    expect(after).toEqual({ ok: true, value: null });
  });

  it('is idempotent — succeeds even when nothing was ever stored', async () => {
    const r = await signOutAtproto();
    expect(r.ok).toBe(true);
  });
});
