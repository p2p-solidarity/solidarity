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
 * Signs a pre-hashed (sha256) digest, returning the raw 64-byte r||s ES256
 * signature. Never receives the private key — implementations may delegate
 * to hardware-backed signing (Secure Enclave / StrongBox / SpruceID).
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
 * Verify a compact JWS was signed by `did`. Checks, in order: 3-part
 * shape, decodable header/payload JSON, `alg === 'ES256'`, the DID segment
 * of `kid` equals `did`, `did` resolves to a P-256 key, and the 64-byte
 * signature is valid for that key over `<headerB64>.<payloadB64>`. Never
 * throws — every failure path returns `err(reason)`; the decoded payload
 * is returned on success.
 */
export function verifyCompact(jws: string, did: string): Result<object, string> {
  const parts = jws.split('.');
  if (parts.length !== 3) return err('malformed JWS: expected 3 dot-separated parts');
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

  // Parse as `unknown` rather than casting straight to `JwsHeader` — this is
  // attacker-controlled input, and a cast would make TS (wrongly) believe
  // `alg`/`kid` are already known-good, silently skipping the checks below.
  let headerRaw: unknown;
  try {
    headerRaw = JSON.parse(bytesToUtf8(base64UrlDecode(headerB64)));
  } catch {
    return err('malformed JWS: header is not valid base64url JSON');
  }
  if (typeof headerRaw !== 'object' || headerRaw === null) {
    return err('malformed JWS: header is not a JSON object');
  }
  const { alg, kid } = headerRaw as Record<string, unknown>;
  if (alg !== 'ES256') return err(`unsupported alg: ${JSON.stringify(alg)}`);
  if (typeof kid !== 'string' || kid.length === 0) return err('missing kid');
  const header: JwsHeader = { alg, kid };
  const hashIdx = header.kid.indexOf('#');
  const kidDid = hashIdx === -1 ? header.kid : header.kid.slice(0, hashIdx);
  if (kidDid !== did) return err('kid does not match did');

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
  const validSignature = p256.verify(sigBytes, digest, publicKey);
  if (!validSignature) return err('signature verification failed');

  let payload: object;
  try {
    payload = JSON.parse(bytesToUtf8(base64UrlDecode(payloadB64))) as object;
  } catch {
    return err('malformed JWS: payload is not valid base64url JSON');
  }
  return ok(payload);
}
