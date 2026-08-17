/**
 * Compact JWS — the single signing primitive for did:key-authenticated
 * payloads (profile signing, DID challenge-response, and the Pear channel
 * handshake all route through this; see docs/ref 04-06 plans). RFC 7515
 * compact serialization: `<headerB64>.<payloadB64>.<signatureB64>`.
 *
 * The protected header is always `{ alg: 'ES256', kid: '<did>#0' }` — a
 * did:key document has exactly one verification method, so `#0` is the
 * only fragment that ever exists. The payload is canonicalized via
 * `stableJSON` (canonical.ts) before encoding, so callers never have to
 * worry about key insertion order producing a different signing input for
 * a logically-identical payload.
 *
 * Signing is indirected through a `Signer` callback instead of taking a
 * raw private key: `keychain/signingKey.ts` in apps/expo backs the active
 * identity key with Secure Enclave / StrongBox and never exposes the
 * private scalar to JS, so this module must be able to delegate the raw
 * ECDSA operation to native code. `Signer` receives the sha256 digest of
 * `<headerB64>.<payloadB64>` (ASCII) — the same digest-then-sign shape
 * `identity/jwt.ts` and `passport/openacV3.ts`'s `DeviceSigner` already use
 * in this codebase — and must return the raw 64-byte r||s signature.
 *
 * RFC 7515 ES256 hashes the signing input exactly once. `@noble/curves`
 * v2's `p256.sign`/`p256.verify` default to `{ prehash: true }` (they hash
 * whatever you pass in again before signing/verifying), so every call in
 * this module passes `{ prehash: false }` explicitly — the digest computed
 * here already *is* the message representative, not raw input that needs
 * hashing. Passing the default would silently sign/verify
 * `sha256(sha256(signingInput))`, which is not RFC 7515 ES256 and does not
 * interoperate with any spec-compliant JOSE implementation (WebCrypto,
 * jose, etc.) — see packages/shared/test/jws.test.ts's WebCrypto
 * cross-implementation tests, which exist specifically to catch a
 * regression back to double-hashing.
 *
 * This intentionally duplicates a small amount of identity/jwt.ts's
 * digest-and-encode logic rather than calling into it: jwt.ts signs with a
 * raw in-memory private key and lets the caller define an arbitrary header
 * shape, whereas this module fixes the header to did:key + ES256 and never
 * touches a private key directly — different enough contracts that sharing
 * one function would need a branchy API. Both reuse the same underlying
 * crypto/base64 + crypto/hash primitives.
 */
import { p256 } from '@noble/curves/nist.js';

import { stableJSON } from './canonical';
import { base64UrlDecode, base64UrlEncode, bytesToUtf8, utf8ToBytes } from './crypto/base64';
import { sha256Bytes } from './crypto/hash';
import { resolveDidKey } from './identity/didKey';
import { jwkToPublicKey } from './identity/keyPair';
import { err, ok, type Result } from './types/result';

/**
 * Signs a pre-hashed digest, returning the raw 64-byte r||s ES256 signature.
 * Never receives the private key — implementations may delegate to
 * hardware-backed signing (Secure Enclave / StrongBox / SpruceID).
 *
 * `digest` is the 32-byte SHA-256 digest of `<headerB64>.<payloadB64>`
 * (ASCII bytes of the signing input) — computed once, by `signCompact`,
 * before this callback is invoked. The implementation MUST perform a raw
 * ECDSA-P256 sign over `digest` with no further hashing: a hardware signer
 * (Secure Enclave/StrongBox) that raw-signs whatever digest it's handed is
 * correct by construction; a software signer built on `@noble/curves` must
 * call `p256.sign(digest, privateKey, { prehash: false })` — the library's
 * default (`prehash: true`) hashes `digest` a second time, which produces a
 * signature over `sha256(sha256(signingInput))` instead of RFC 7515 ES256's
 * `sha256(signingInput)`.
 */
export type Signer = (digest: Uint8Array) => Promise<Uint8Array>;

export interface JwsHeader {
  readonly alg: 'ES256';
  readonly kid: string;
}

const RAW_SIGNATURE_LENGTH = 64; // ES256 r||s, 32 bytes each

/**
 * Sign `payload` as a compact JWS under `did`. The protected header is
 * fixed to `{ alg: 'ES256', kid: '<did>#0' }`; the payload is encoded via
 * `stableJSON` so the same logical object always produces the same signing
 * input. Throws only if `sign` rejects or returns a signature that isn't
 * exactly 64 bytes (a caller-side programming error, not a runtime/network
 * failure the caller needs to branch on).
 */
export async function signCompact(payload: object, did: string, sign: Signer): Promise<string> {
  const header: JwsHeader = { alg: 'ES256', kid: `${did}#0` };
  const headerB64 = base64UrlEncode(utf8ToBytes(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(utf8ToBytes(stableJSON(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const digest = sha256Bytes(signingInput);
  const sigBytes = await sign(digest);
  if (sigBytes.length !== RAW_SIGNATURE_LENGTH) {
    throw new Error(
      `signCompact: signer must return a ${String(RAW_SIGNATURE_LENGTH)}-byte r||s signature (got ${String(sigBytes.length)})`
    );
  }
  return `${signingInput}.${base64UrlEncode(sigBytes)}`;
}

/**
 * Parses and validates the protected header segment for `verifyCompact`.
 * Split out so `verifyCompact` itself stays under the project's cyclomatic
 * complexity budget — this one function owns every header-shape policy
 * check (RFC 7515 §4.1.11 exactness + did:key kid exactness) so the two
 * attack classes (`extra header member`, `wrong kid fragment`) each have a
 * single, obvious point of enforcement.
 */
function parseAndValidateHeader(headerB64: string, did: string): Result<JwsHeader, string> {
  // Parse as `unknown` rather than casting straight to `JwsHeader` — this is
  // attacker-controlled input, and a cast would make TS (wrongly) believe
  // `alg`/`kid` are already known-good, silently skipping the checks below.
  let headerRaw: unknown;
  try {
    headerRaw = JSON.parse(bytesToUtf8(base64UrlDecode(headerB64)));
  } catch {
    return err('malformed JWS: header is not valid base64url JSON');
  }
  if (typeof headerRaw !== 'object' || headerRaw === null || Array.isArray(headerRaw)) {
    return err('malformed JWS: header is not a JSON object');
  }
  const headerKeys = Object.keys(headerRaw).sort();
  if (headerKeys.length !== 2 || headerKeys[0] !== 'alg' || headerKeys[1] !== 'kid') {
    // RFC 7515 §4.1.11 rationale: a verifier that silently ignores
    // unrecognized header members (e.g. `crit`, `b64`) can be tricked into
    // validating a JWS under a security policy the signer didn't intend.
    // We only ever produce/accept the fixed did:key header shape, so any
    // extra or missing member is rejected outright.
    return err(`malformed JWS: header must contain exactly {alg, kid} (got ${JSON.stringify(headerKeys)})`);
  }
  const { alg, kid } = headerRaw as Record<string, unknown>;
  if (alg !== 'ES256') return err(`unsupported alg: ${JSON.stringify(alg)}`);
  if (typeof kid !== 'string' || kid.length === 0) return err('missing kid');
  const expectedKid = `${did}#0`;
  if (kid !== expectedKid) {
    return err(`kid does not match did: expected ${JSON.stringify(expectedKid)}, got ${JSON.stringify(kid)}`);
  }
  return ok({ alg, kid });
}

/**
 * Verify a compact JWS was signed by `did`. Checks, in order: 3-part
 * shape, decodable header/payload JSON, header is *exactly*
 * `{alg, kid}` (RFC 7515 §4.1.11: an unrecognized/extra member such as
 * `crit` or `b64` must fail closed, not be silently ignored), `alg ===
 * 'ES256'`, `kid` is exactly `` `${did}#0` `` (a did:key document has one
 * verification method — no other fragment is ever valid), `did` resolves
 * to a P-256 key, and the 64-byte signature is valid for that key over
 * `<headerB64>.<payloadB64>` (single SHA-256 hash, `prehash: false` — see
 * module docstring). Never throws — every failure path returns
 * `err(reason)`; the decoded payload is returned on success.
 */
export function verifyCompact(jws: string, did: string): Result<object, string> {
  const parts = jws.split('.');
  if (parts.length !== 3) return err('malformed JWS: expected 3 dot-separated parts');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  const headerResult = parseAndValidateHeader(headerB64, did);
  if (!headerResult.ok) return headerResult;

  let publicKey: Uint8Array;
  try {
    publicKey = jwkToPublicKey(resolveDidKey(did));
  } catch (e) {
    return err(`could not resolve did: ${e instanceof Error ? e.message : String(e)}`);
  }

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(signatureB64);
  } catch {
    return err('malformed JWS: signature is not valid base64url');
  }
  if (sigBytes.length !== RAW_SIGNATURE_LENGTH) {
    return err(`signature must be ${String(RAW_SIGNATURE_LENGTH)} raw bytes (r||s)`);
  }

  const digest = sha256Bytes(`${headerB64}.${payloadB64}`);
  // `prehash: false` — `digest` is already the RFC 7515 ES256 message
  // representative; @noble/curves defaults to `prehash: true` and would
  // hash it a second time (see module docstring). `lowS` is left at its
  // default (`true`): malleable/high-S signatures are still rejected.
  const validSignature = p256.verify(sigBytes, digest, publicKey, { prehash: false });
  if (!validSignature) return err('signature verification failed');

  let payload: object;
  try {
    payload = JSON.parse(bytesToUtf8(base64UrlDecode(payloadB64))) as object;
  } catch {
    return err('malformed JWS: payload is not valid base64url JSON');
  }
  return ok(payload);
}
