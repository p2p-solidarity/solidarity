/**
 * OIDCTokenService — TS port of the token-endpoint client embedded in
 * solidarity/Services/OIDC/CredentialIssuanceService.swift `requestToken`.
 *
 * Supports the two grants OID4VCI in the wild uses:
 *   1. `urn:ietf:params:oauth:grant-type:pre-authorized_code` (most common
 *      for credential offers).
 *   2. `authorization_code` (interactive auth-code flow, optional PKCE).
 *
 * Wire-format parity with Swift:
 *   - POST application/x-www-form-urlencoded.
 *   - Pre-auth grant: sends `pre-authorized_code`. When `tx_code` is set
 *     and a userPin is supplied, sends BOTH `tx_code` (OID4VCI final §6.1)
 *     and `user_pin` (legacy draft 13) so old + new issuers both work.
 *   - Auth-code grant: sends `code`, `redirect_uri`, `client_id`, and
 *     optionally `code_verifier` (PKCE).
 *
 * Returns `Result<TokenResponse, OidcError>` instead of throwing, mirroring
 * Swift `CardResult<VCITokenResponse>`.
 */
import { err, ok, type Result } from '@solidarity/shared';

import { oidcError, type OidcError } from './errors';

export type TokenGrant =
  | {
      readonly type: 'pre-authorized_code';
      readonly preAuthorizedCode: string;
      /** Optional transaction code (Swift `tx_code` / legacy `user_pin`). */
      readonly txCode?: string;
    }
  | {
      readonly type: 'authorization_code';
      readonly code: string;
      readonly redirectUri: string;
      readonly clientId: string;
      readonly codeVerifier?: string;
    };

export interface TokenResponse {
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_in?: number;
  readonly c_nonce?: string;
  readonly c_nonce_expires_in?: number;
  /** OID4VCI final: issuer-picked `credential_identifiers` per descriptor. */
  readonly authorization_details?: readonly Record<string, unknown>[];
}

interface RequestTokenOpts {
  readonly tokenEndpoint: string;
  readonly grant: TokenGrant;
  /** Bearer/access-token header to attach if the AS requires client auth. */
  readonly clientAuthorization?: string;
  /** Override fetch (tests). Defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Override request timeout (ms). Defaults to 30 s. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildBody(grant: TokenGrant): URLSearchParams {
  const body = new URLSearchParams();
  if (grant.type === 'pre-authorized_code') {
    body.set('grant_type', 'urn:ietf:params:oauth:grant-type:pre-authorized_code');
    body.set('pre-authorized_code', grant.preAuthorizedCode);
    if (grant.txCode) {
      body.set('tx_code', grant.txCode);
      body.set('user_pin', grant.txCode);
    }
    return body;
  }
  body.set('grant_type', 'authorization_code');
  body.set('code', grant.code);
  body.set('redirect_uri', grant.redirectUri);
  body.set('client_id', grant.clientId);
  if (grant.codeVerifier) {
    body.set('code_verifier', grant.codeVerifier);
  }
  return body;
}

function looksLikeTokenResponse(value: unknown): value is TokenResponse {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['access_token'] === 'string' && typeof v['token_type'] === 'string';
}

export async function requestToken(
  opts: RequestTokenOpts
): Promise<Result<TokenResponse, OidcError>> {
  const body = buildBody(opts.grant);
  const ac = new AbortController();
  const timeout = setTimeout(() => { ac.abort(); }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
    };
    if (opts.clientAuthorization) {
      headers['authorization'] = opts.clientAuthorization;
    }
    const fetchImpl = opts.fetchImpl ?? fetch;
    const response = await fetchImpl(opts.tokenEndpoint, {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: ac.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return err(
        oidcError(
          'tokenRequestFailed',
          `Token endpoint returned HTTP ${String(response.status)}${text ? `: ${text.slice(0, 200)}` : ''}`,
          response.status
        )
      );
    }
    const json = (await response.json()) as unknown;
    if (!looksLikeTokenResponse(json)) {
      return err(oidcError('tokenRequestFailed', 'Token response missing access_token/token_type'));
    }
    return ok(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(oidcError('networkError', `Token request failed: ${message}`));
  } finally {
    clearTimeout(timeout);
  }
}
