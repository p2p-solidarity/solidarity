/**
 * DPoP (RFC 9449) — atproto mandates DPoP for every PAR/token/resource
 * request (https://atproto.com/specs/oauth §"Demonstrating Proof of
 * Possession"), including server-issued nonces.
 *
 * ── Lib-vs-hand-rolled decision (task A6.1) ──────────────────────────────
 *
 * Investigated `@atproto/oauth-client` + `@atproto/oauth-client-browser`
 * (the "maintained JS libs"): both are npm-published but explicitly
 * browser/Node-only — `oauth-client-browser`'s own package description is
 * "relies on WebCrypto & Indexed DB" (neither exists in Hermes/RN without
 * heavy polyfilling), and `oauth-client`'s `engines.node` is `>=22`.
 * There IS `@atproto/oauth-client-expo` (v0.1.4, pre-1.0), but it ships a
 * NEW native Expo module (`ios/*.swift` + `android/*.kt`,
 * `ExpoAtprotoOAuthClientModule` implementing `digest`/`generatePrivateJwk`
 * /`createJwt`/`verifyJwt` natively) plus a hard dependency on
 * `react-native-mmkv@^3` — this app is already on `react-native-mmkv@^4`
 * (the Nitro-based rewrite; a different native ABI), so pulling v0.1.4 in
 * means either a conflicting second MMKV native module or a downgrade of
 * an already-integrated dependency, on top of an unvetted pre-1.0 native
 * surface. Given this app already has every primitive DPoP needs —
 * `@noble/curves` P-256 keygen/sign (`identity/keyPair.ts`), a generic
 * ES256 JWT signer (`identity/jwt.ts`'s `signJwtEs256`, header shape is
 * caller-defined so it already supports embedding a `jwk` claim), and
 * `crypto.getRandomValues` already polyfilled app-wide via
 * `react-native-get-random-values` (imported first in `app/_layout.tsx`)
 * — hand-rolling DPoP here adds zero new native surface and zero new
 * dependencies. This module is that hand-rolled implementation.
 *
 * ── What this module owns ────────────────────────────────────────────────
 *
 * - `generateDpopKeyPair()`: a fresh, ephemeral P-256 keypair — one per
 *   OAuth session (never the user's root did:key or Nostr key). Persisted
 *   by `session.ts` in `expo-secure-store`, reused for every request in
 *   that session's lifetime (PAR, token, refresh, future resource calls) —
 *   RFC 9449 binds tokens to ONE key for the life of the session; rotating
 *   it per-request would break the AS's proof-of-possession check.
 * - `buildDpopProof()`: signs the JWT — header `{typ:'dpop+jwt', alg:
 *   'ES256', jwk:{kty,crv,x,y}}` (RFC 9449 §4.2 minimal public JWK — no
 *   `d`, no `alg`/`use` inside `jwk`), payload `{jti, htm, htu, iat,
 *   [nonce], [ath]}`. `ath` (RFC 9449 §4.3, access-token hash) is only set
 *   when `accessToken` is passed — PAR/initial-token requests never carry
 *   the not-yet-issued access token, only later resource requests do.
 */
import {
  base64UrlEncode,
  generateP256KeyPair,
  publicKeyToJwk,
  randomChallengeNonce,
  sha256Bytes,
  signJwtEs256,
  type JwtHeader,
  type PublicKeyJWK,
} from '@solidarity/shared';

export interface DpopKeyPair {
  readonly privateKey: Uint8Array;
  readonly publicJwk: PublicKeyJWK;
}

/** Fresh ephemeral P-256 DPoP keypair. Generate ONCE per OAuth session — see module doc. */
export function generateDpopKeyPair(): DpopKeyPair {
  const { privateKey, publicKey } = generateP256KeyPair();
  return { privateKey, publicJwk: publicKeyToJwk(publicKey) };
}

export interface DpopProofInput {
  /** HTTP method, e.g. 'POST'. Case doesn't matter to us; upper-cased before signing. */
  readonly htm: string;
  /** Target URL. Query string and fragment are stripped before signing regardless (RFC 9449 §4.2). */
  readonly htu: string;
  /** Most recent `DPoP-Nonce` value seen from this server, if any. */
  readonly nonce?: string;
  /** The access token this proof accompanies — set only for resource-server requests, never PAR/token requests. */
  readonly accessToken?: string;
}

/** Minimal RFC 9449 §4.2 public JWK: kty/crv/x/y only — no `alg`, no `d`. */
function minimalPublicJwk(jwk: PublicKeyJWK): { kty: 'EC'; crv: 'P-256'; x: string; y: string } {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
}

/** RFC 9449 §4.2: `htu` MUST NOT include the query or fragment parts. Strips them before signing. */
function normalizeHtu(htu: string): string {
  try {
    const u = new URL(htu);
    u.search = '';
    u.hash = '';
    return u.href;
  } catch {
    // Not a parseable absolute URL — pass through verbatim rather than
    // throwing; a malformed `htu` will simply fail server-side verification.
    return htu;
  }
}

/**
 * Sign a fresh DPoP proof JWT. A unique `jti` is generated for every call
 * (RFC 9449: "Each DPoP proof JWT must have a unique... jti"), so this
 * must be called once per HTTP request, never cached/reused.
 */
export function buildDpopProof(keyPair: DpopKeyPair, input: DpopProofInput): string {
  const header: JwtHeader = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: minimalPublicJwk(keyPair.publicJwk),
  };
  const payload: Record<string, unknown> = {
    jti: randomChallengeNonce(),
    htm: input.htm.toUpperCase(),
    htu: normalizeHtu(input.htu),
    iat: Math.floor(Date.now() / 1000),
  };
  if (input.nonce) payload['nonce'] = input.nonce;
  if (input.accessToken) payload['ath'] = base64UrlEncode(sha256Bytes(input.accessToken));
  return signJwtEs256(header, payload, keyPair.privateKey);
}
