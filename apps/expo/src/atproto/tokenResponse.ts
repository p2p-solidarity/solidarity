/**
 * atproto OAuth token-response parsing + expiry math (task A6.1).
 * Pure — no I/O. Shared by the initial authorization-code exchange and
 * refresh-token exchange in `oauth.ts` (identical response shape per
 * https://atproto.com/specs/oauth §"Tokens and Session Lifetime").
 *
 * Validates the atproto-specific requirements the spec calls "critical
 * (mandatory)": `token_type` must be `DPoP` (bearer tokens are not
 * sender-constrained — accepting one would silently downgrade security),
 * `scope` must contain `atproto` ("Clients should reject token responses
 * if they don't contain a scope field, or if the scope field does not
 * contain atproto"), and `sub` (the account DID) must be present so the
 * caller can cross-check it against the identity resolved before the flow
 * started (`oauth.ts` does that check — this module only parses).
 */
import { err, ok, type Result } from '@solidarity/shared';

export interface AtprotoTokenResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Account DID from the response's `sub` field — NOT yet cross-checked against the expected identity. */
  readonly sub: string;
  readonly scope: string;
  readonly expiresAtMs: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parse + validate a raw JSON token-endpoint response. `nowMs` is
 * injectable for deterministic expiry-math tests; defaults to `Date.now()`.
 */
export function parseAtprotoTokenResponse(json: unknown, nowMs: number = Date.now()): Result<AtprotoTokenResult, string> {
  if (!isRecord(json)) return err('token response is not a JSON object');

  const { access_token, token_type, refresh_token, sub, scope, expires_in } = json;

  if (typeof access_token !== 'string' || access_token.length === 0) {
    return err('token response missing access_token');
  }
  if (typeof token_type !== 'string' || token_type.toLowerCase() !== 'dpop') {
    return err(`token response token_type must be "DPoP" (got ${JSON.stringify(token_type)}) — atproto requires DPoP-bound tokens`);
  }
  if (typeof refresh_token !== 'string' || refresh_token.length === 0) {
    return err('token response missing refresh_token');
  }
  if (typeof sub !== 'string' || !sub.startsWith('did:')) {
    return err(`token response missing/invalid sub (expected a DID, got ${JSON.stringify(sub)})`);
  }
  if (typeof scope !== 'string' || !scope.split(/\s+/u).includes('atproto')) {
    return err('token response scope does not include "atproto"');
  }
  if (typeof expires_in !== 'number' || !Number.isFinite(expires_in) || expires_in <= 0) {
    return err(`token response missing/invalid expires_in (got ${JSON.stringify(expires_in)})`);
  }

  return ok({
    accessToken: access_token,
    refreshToken: refresh_token,
    sub,
    scope,
    expiresAtMs: nowMs + expires_in * 1000,
  });
}
