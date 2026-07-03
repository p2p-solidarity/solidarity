/**
 * atproto OAuth client — 1.3.3 Phase A6 task A6.1 (US-02, Bluesky/atproto
 * account binding). PAR + PKCE + DPoP, hand-rolled per `dpop.ts`'s module
 * doc (the maintained JS libs are browser/Node-only or pull an unvetted
 * pre-1.0 native module with a conflicting `react-native-mmkv` major
 * version — see that file for the full investigation). Interactive
 * browser step is a thin injectable seam (`AtprotoBrowserLauncher`); every
 * other step is fetch-injectable and covered by
 * `__tests__/unit/atprotoOAuth.test.ts`.
 *
 * ── Flow (https://atproto.com/specs/oauth "Summary of Authorization Flow") ─
 *
 *   1. `discovery.ts`'s `resolveAtprotoIdentity(handle)` — handle → DID →
 *      PDS, with the mandatory bidirectional handle↔DID check.
 *   2. `discovery.ts`'s `discoverAuthServerMetadata(pdsUrl)` — PDS →
 *      Authorization Server, metadata validated (PAR/DPoP/PKCE support).
 *   3. Fresh `pkce.ts` PKCE pair, fresh `state`, fresh ephemeral
 *      `dpop.ts` P-256 keypair for THIS session.
 *   4. PAR (`postWithDpop`, DPoP-nonce-retry built in) → `request_uri`.
 *   5. Persist a `PendingAtprotoFlow` to `session.ts`'s secure storage
 *      BEFORE opening the browser — the spec explicitly calls out that the
 *      interactive hop can outlive the JS context.
 *   6. `browserLauncher(authorizeUrl, redirectUri)` — default implementation
 *      opens `expo-web-browser`'s `openAuthSessionAsync` (ASWebAuthentication
 *      Session on iOS, Custom Tabs auth-session on Android); resolves with
 *      the final redirect URL, captured natively — no app-level deep-link
 *      router wiring needed for this step.
 *   7. Parse the redirect: `error` → fail; `state` MUST match; `iss` MUST
 *      match the Authorization Server bound to this flow (spec: "critical
 *      (mandatory) to confirm... issuer field matches"); exchange `code`
 *      for tokens (same DPoP key, PKCE `code_verifier`).
 *   8. Token response's `sub` (DID) MUST match the DID resolved in step 1
 *      (spec: "critical for the client to verify that this DID matches the
 *      expected DID") — this is what stops a malicious/misconfigured
 *      Authorization Server from authenticating a different account than
 *      the one the user typed a handle for.
 *   9. Persist the session (own secure-store namespace, see `session.ts`),
 *      clear the pending-flow entry, return the public-safe `AtprotoSession`.
 *
 * ── DPoP nonce handling ────────────────────────────────────────────────────
 *
 * atproto mandates server-issued DPoP nonces on every DPoP-protected
 * response (PAR, token). `postWithDpop` retries exactly once: send without
 * a nonce (or the last known one), and if the server responds
 * `400 {error: 'use_dpop_nonce'}` with a fresh `DPoP-Nonce` header, retry
 * with that nonce. A successful response MUST also carry `DPoP-Nonce` —
 * its absence is treated as a protocol violation (spec: "Clients must
 * reject responses missing a DPoP-Nonce header... if the request included
 * DPoP").
 *
 * ── What is NOT in scope for A6.1 ─────────────────────────────────────────
 *
 * Writing the `app.solidarity.profile` PDS record via
 * `com.atproto.repo.putRecord` is task A6.2 — it will reuse this module's
 * persisted session + `dpop.ts`'s `buildDpopProof` to authenticate its own
 * PDS requests (same DPoP key, `ath` claim set from the access token).
 * `signOutAtproto()` here is a LOCAL wipe only — it does not attempt
 * server-side session/token revocation (atproto does not universally
 * advertise a revocation endpoint); this is intentionally not overstated.
 */
import { bytesToHex, err, hexToBytes, ok, randomChallengeNonce, type Result } from '@solidarity/shared';

import { ATPROTO_CLIENT_ID, ATPROTO_REDIRECT_URI, ATPROTO_SCOPE } from './clientMetadata';
import { buildDpopProof, generateDpopKeyPair, type DpopKeyPair } from './dpop';
import { discoverAuthServerMetadata, resolveAtprotoIdentity } from './discovery';
import { generatePkce } from './pkce';
import {
  getAtprotoSessionStorage,
  toPublicSession,
  type AtprotoSession,
  type PendingAtprotoFlow,
  type PersistedAtprotoSession,
} from './session';
import { parseAtprotoTokenResponse } from './tokenResponse';

export type { AtprotoSession } from './session';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── Browser launcher — the one non-fetch, non-storage IO seam ─────────────

export interface BrowserAuthResult {
  readonly type: 'success' | 'cancel' | 'dismiss';
  /** Final redirect URL — only set when `type === 'success'`. */
  readonly url?: string;
}

/** Opens the interactive authorize URL and resolves with the final redirect. Injectable for tests. */
export type AtprotoBrowserLauncher = (authorizeUrl: string, redirectUri: string) => Promise<BrowserAuthResult>;

async function defaultBrowserLauncher(authorizeUrl: string, redirectUri: string): Promise<BrowserAuthResult> {
  // Lazy-imported — same rationale as `session.ts`'s `loadSecureStore`:
  // keep native modules out of this file's module-load graph so it stays
  // importable (types + pure logic) under `bun test` without a native runtime.
  const WebBrowser = await import('expo-web-browser');
  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);
  if (result.type === 'success') return { type: 'success', url: result.url };
  if (result.type === WebBrowser.WebBrowserResultType.CANCEL) return { type: 'cancel' };
  return { type: 'dismiss' };
}

// ── DPoP-authenticated POST with the mandatory nonce-retry dance ──────────

interface DpopPostResult {
  readonly json: unknown;
  readonly dpopNonce: string;
}

async function postWithDpop(
  url: string,
  body: URLSearchParams,
  dpopKeyPair: DpopKeyPair,
  fetchImpl: typeof fetch,
  startingNonce?: string
): Promise<Result<DpopPostResult, string>> {
  let nonce = startingNonce;
  for (let attempt = 0; attempt < 2; attempt++) {
    const proof = buildDpopProof(dpopKeyPair, { htm: 'POST', htu: url, nonce });
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', DPoP: proof },
        body: body.toString(),
      });
    } catch (e) {
      return err(`network error POSTing to ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }

    const freshNonce = response.headers.get('DPoP-Nonce') ?? undefined;

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = await response.text();
      } catch {
        // best-effort — an unreadable body still produces a useful HTTP-status error below
      }
      let parsedError: unknown = null;
      try {
        parsedError = JSON.parse(bodyText);
      } catch {
        // not JSON — fall through with bodyText only
      }
      const rawErrorCode = isRecord(parsedError) ? parsedError['error'] : undefined;
      const errorCode = typeof rawErrorCode === 'string' ? rawErrorCode : undefined;
      if (attempt === 0 && errorCode === 'use_dpop_nonce' && freshNonce) {
        nonce = freshNonce;
        continue;
      }
      return err(
        `HTTP ${String(response.status)} from ${url}${errorCode ? ` (${errorCode})` : ''}${bodyText ? `: ${bodyText.slice(0, 300)}` : ''}`
      );
    }

    if (!freshNonce) {
      return err(`response from ${url} is missing the required DPoP-Nonce header`);
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return err(`response from ${url} is not valid JSON`);
    }
    return ok({ json, dpopNonce: freshNonce });
  }
  return err(`DPoP nonce retry exhausted for ${url}`);
}

// ── Step 1-6: start the flow ────────────────────────────────────────────

export interface StartAtprotoOAuthOpts {
  /** Override fetch (tests). Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Override the interactive browser step (tests). Defaults to `expo-web-browser`. */
  readonly browserLauncher?: AtprotoBrowserLauncher;
}

/**
 * Begin (and, on a successful interactive step, complete) an atproto OAuth
 * sign-in for `handle`. Never throws — every failure path is `err(...)`.
 */
export async function startAtprotoOAuth(handle: string, opts?: StartAtprotoOAuthOpts): Promise<Result<AtprotoSession, string>> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const browserLauncher = opts?.browserLauncher ?? defaultBrowserLauncher;
  const storage = getAtprotoSessionStorage();

  const identityResult = await resolveAtprotoIdentity(handle, fetchImpl);
  if (!identityResult.ok) return identityResult;
  const identity = identityResult.value;

  const asMetadataResult = await discoverAuthServerMetadata(identity.pdsUrl, fetchImpl);
  if (!asMetadataResult.ok) return asMetadataResult;
  const asMetadata = asMetadataResult.value;

  const pkce = generatePkce();
  const state = randomChallengeNonce();
  const dpopKeyPair = generateDpopKeyPair();

  const parBody = new URLSearchParams();
  parBody.set('response_type', 'code');
  parBody.set('client_id', ATPROTO_CLIENT_ID);
  parBody.set('redirect_uri', ATPROTO_REDIRECT_URI);
  parBody.set('scope', ATPROTO_SCOPE);
  parBody.set('code_challenge', pkce.codeChallenge);
  parBody.set('code_challenge_method', pkce.codeChallengeMethod);
  parBody.set('state', state);
  parBody.set('login_hint', identity.handle);

  const parResult = await postWithDpop(asMetadata.pushedAuthorizationRequestEndpoint, parBody, dpopKeyPair, fetchImpl);
  if (!parResult.ok) return err(`pushed authorization request failed: ${parResult.error}`);
  if (!isRecord(parResult.value.json) || typeof parResult.value.json['request_uri'] !== 'string') {
    return err('pushed authorization response is missing request_uri');
  }
  const requestUri = parResult.value.json['request_uri'];

  const pending: PendingAtprotoFlow = {
    state,
    codeVerifier: pkce.codeVerifier,
    handle: identity.handle,
    expectedDid: identity.did,
    pdsUrl: identity.pdsUrl,
    authServerIssuer: asMetadata.issuer,
    authorizationEndpoint: asMetadata.authorizationEndpoint,
    tokenEndpoint: asMetadata.tokenEndpoint,
    pushedAuthorizationRequestEndpoint: asMetadata.pushedAuthorizationRequestEndpoint,
    redirectUri: ATPROTO_REDIRECT_URI,
    dpopPrivateKeyHex: bytesToHex(dpopKeyPair.privateKey),
    dpopPublicJwk: dpopKeyPair.publicJwk,
    dpopNonce: parResult.value.dpopNonce,
  };
  await storage.setPendingFlow(pending);

  const authorizeUrl = `${asMetadata.authorizationEndpoint}?${new URLSearchParams({
    client_id: ATPROTO_CLIENT_ID,
    request_uri: requestUri,
  }).toString()}`;

  const browserResult = await browserLauncher(authorizeUrl, ATPROTO_REDIRECT_URI);
  if (browserResult.type !== 'success' || !browserResult.url) {
    await storage.deletePendingFlow();
    return err(
      browserResult.type === 'cancel'
        ? 'user cancelled the atproto sign-in'
        : 'atproto sign-in browser session ended without a result'
    );
  }

  return completeAtprotoOAuthCallback(browserResult.url, fetchImpl);
}

// ── Step 7-9: parse the redirect, exchange the code, persist the session ──

async function completeAtprotoOAuthCallback(redirectUrl: string, fetchImpl: typeof fetch): Promise<Result<AtprotoSession, string>> {
  const storage = getAtprotoSessionStorage();
  const pending = await storage.getPendingFlow();
  if (!pending) return err('no pending atproto authorization flow — call startAtprotoOAuth first');

  let redirect: URL;
  try {
    redirect = new URL(redirectUrl);
  } catch {
    await storage.deletePendingFlow();
    return err('redirect URL is malformed');
  }
  const params = redirect.searchParams;

  const oauthError = params.get('error');
  if (oauthError) {
    await storage.deletePendingFlow();
    const description = params.get('error_description');
    return err(`authorization server rejected the request: ${oauthError}${description ? ` — ${description}` : ''}`);
  }

  const returnedState = params.get('state');
  if (returnedState !== pending.state) {
    await storage.deletePendingFlow();
    return err('state mismatch on OAuth redirect — possible CSRF or a stale callback');
  }

  // Mandatory per spec: "critical (mandatory) to confirm... issuer field matches".
  const issuer = params.get('iss');
  if (issuer !== pending.authServerIssuer) {
    await storage.deletePendingFlow();
    return err(
      `redirect iss (${String(issuer)}) does not match the Authorization Server bound to this flow (${pending.authServerIssuer}) — refusing to trust the response`
    );
  }

  const code = params.get('code');
  if (!code) {
    await storage.deletePendingFlow();
    return err('OAuth redirect is missing the authorization code');
  }

  const dpopKeyPair: DpopKeyPair = { privateKey: hexToBytes(pending.dpopPrivateKeyHex), publicJwk: pending.dpopPublicJwk };

  const tokenBody = new URLSearchParams();
  tokenBody.set('grant_type', 'authorization_code');
  tokenBody.set('code', code);
  tokenBody.set('redirect_uri', pending.redirectUri);
  tokenBody.set('client_id', ATPROTO_CLIENT_ID);
  tokenBody.set('code_verifier', pending.codeVerifier);

  const tokenResult = await postWithDpop(pending.tokenEndpoint, tokenBody, dpopKeyPair, fetchImpl, pending.dpopNonce);
  if (!tokenResult.ok) {
    await storage.deletePendingFlow();
    return err(`token exchange failed: ${tokenResult.error}`);
  }

  const parsed = parseAtprotoTokenResponse(tokenResult.value.json);
  if (!parsed.ok) {
    await storage.deletePendingFlow();
    return err(`token exchange: ${parsed.error}`);
  }

  // Mandatory per spec: "critical for the client to verify that this DID
  // matches the expected DID bound to the session earlier".
  if (parsed.value.sub !== pending.expectedDid) {
    await storage.deletePendingFlow();
    return err(
      `token response sub (${parsed.value.sub}) does not match the identity resolved before sign-in (${pending.expectedDid}) — refusing to bind a mismatched account`
    );
  }

  const session: PersistedAtprotoSession = {
    did: pending.expectedDid,
    handle: pending.handle,
    pdsUrl: pending.pdsUrl,
    authServerIssuer: pending.authServerIssuer,
    tokenEndpoint: pending.tokenEndpoint,
    accessToken: parsed.value.accessToken,
    accessTokenExpiresAtMs: parsed.value.expiresAtMs,
    scope: parsed.value.scope,
    refreshToken: parsed.value.refreshToken,
    dpopPrivateKeyHex: pending.dpopPrivateKeyHex,
    dpopPublicJwk: pending.dpopPublicJwk,
  };
  await storage.setSession(session);
  await storage.deletePendingFlow();
  return ok(toPublicSession(session));
}

// ── Read / refresh / sign-out ───────────────────────────────────────────

/** The persisted session, or `null` if never signed in / signed out. Never auto-refreshes — see module doc. */
export async function getAtprotoSession(): Promise<Result<AtprotoSession | null, string>> {
  try {
    const session = await getAtprotoSessionStorage().getSession();
    return ok(session ? toPublicSession(session) : null);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}

export interface RefreshAtprotoSessionOpts {
  readonly fetchImpl?: typeof fetch;
}

/**
 * Exchange the stored refresh token for a new access+refresh token pair,
 * using the SAME DPoP key the session was created with (RFC 9449: tokens
 * are bound to one key for the session's lifetime). Refresh tokens are
 * single-use — the stored one is atomically replaced on success.
 */
export async function refreshAtprotoSession(opts?: RefreshAtprotoSessionOpts): Promise<Result<AtprotoSession, string>> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const storage = getAtprotoSessionStorage();
  const stored = await storage.getSession();
  if (!stored) return err('not signed in to atproto — call startAtprotoOAuth first');

  const dpopKeyPair: DpopKeyPair = { privateKey: hexToBytes(stored.dpopPrivateKeyHex), publicJwk: stored.dpopPublicJwk };

  const body = new URLSearchParams();
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', stored.refreshToken);
  body.set('client_id', ATPROTO_CLIENT_ID);

  const tokenResult = await postWithDpop(stored.tokenEndpoint, body, dpopKeyPair, fetchImpl);
  if (!tokenResult.ok) return err(`token refresh failed: ${tokenResult.error}`);

  const parsed = parseAtprotoTokenResponse(tokenResult.value.json);
  if (!parsed.ok) return err(`token refresh: ${parsed.error}`);

  if (parsed.value.sub !== stored.did) {
    return err(`refresh response sub (${parsed.value.sub}) does not match the signed-in account (${stored.did})`);
  }

  const updated: PersistedAtprotoSession = {
    ...stored,
    accessToken: parsed.value.accessToken,
    accessTokenExpiresAtMs: parsed.value.expiresAtMs,
    scope: parsed.value.scope,
    refreshToken: parsed.value.refreshToken,
  };
  await storage.setSession(updated);
  return ok(toPublicSession(updated));
}

/**
 * Local sign-out: wipes the persisted session, the DPoP key, and any
 * abandoned pending-flow entry. Does NOT attempt server-side revocation
 * (see module doc) — idempotent, always succeeds even if nothing was
 * stored.
 */
export async function signOutAtproto(): Promise<Result<void, string>> {
  const storage = getAtprotoSessionStorage();
  try {
    await storage.deleteSession();
    await storage.deletePendingFlow();
    return ok(undefined);
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
