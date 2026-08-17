/**
 * PKCE (RFC 7636) — mandatory for every atproto OAuth Authorization
 * Request (S256 only; `plain` is explicitly disallowed by the atproto
 * profile). Pure, no I/O — reuses `randomChallengeNonce()`
 * (`@solidarity/shared`'s `challenge.ts`) for the verifier's entropy
 * source instead of a second `crypto.getRandomValues` wrapper: 32 random
 * bytes base64url-encoded is 43 characters, which is both RFC 7636's
 * minimum `code_verifier` length and comfortably inside its
 * "unreserved" charset (`[A-Za-z0-9-._~]` allowed; base64url's
 * `[A-Za-z0-9_-]` output is a strict subset).
 */
import { base64UrlEncode, randomChallengeNonce, sha256Bytes } from '@solidarity/shared';

export interface PkcePair {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: 'S256';
}

/** Fresh PKCE verifier/challenge pair. A new pair MUST be generated per Authorization Request. */
export function generatePkce(): PkcePair {
  const codeVerifier = randomChallengeNonce();
  const codeChallenge = base64UrlEncode(sha256Bytes(codeVerifier));
  return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
}
