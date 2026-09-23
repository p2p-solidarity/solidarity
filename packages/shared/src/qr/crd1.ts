/**
 * CRD1 — the evidence-pack QR wire (CREDS.md §18, mock v3 §s-page/pg-pack).
 *
 *   claims (JSON object)
 *     → CBOR                    (cbor.ts, canonical map order)
 *     → COSE_Sign1 (tag 18)     (ES256 over the COSE Sig_structure)
 *     → zlib                    (RFC 1950 wrapper — NOT the raw-DEFLATE
 *                                `sce1:` framing, which stays Swift-parity)
 *     → Base45                  (RFC 9285, QR-alphanumeric charset)
 *     → "CRD1:" + text
 *
 * Hard limits (all fail closed):
 *   - `CRD1_MAX_CHARS` = 2,420 — QR version 40 at EC level Q in
 *     alphanumeric mode. Encoding returns `over-capacity` instead of a wire;
 *     decoding rejects longer inputs outright (no legitimate QR produces them).
 *   - Validity is capped at 30 days: encode clamps `exp`, decode rejects
 *     packs that are expired, not yet issued (beyond clock skew), or claim a
 *     window longer than 30 days.
 *   - zlib output is capped to keep a malicious wire from inflating into a
 *     multi-MB allocation.
 *
 * Signature model: single ES256 signature under the holder's did:key. The
 * mock's "creds.id 副署" (server countersignature) and transparency-log
 * position require infrastructure this app does not have — they are honestly
 * absent, not faked (repo rule: no fake data).
 *
 * The signer receives the raw Sig_structure MESSAGE bytes and must return a
 * 64-byte r||s ECDSA-P256 signature over SHA-256(message) — i.e. exactly one
 * hash, computed by the signer. `keychain/signingKey.signRawEs256` and a
 * digest-`Signer` wrapped as `(m) => signer(sha256Bytes(m))` both satisfy it.
 */
import { p256 } from '@noble/curves/nist.js';
import { unzlibSync, zlibSync } from 'fflate';

import { sha256Bytes } from '../crypto/hash';
import { resolveDidKey } from '../identity/didKey';
import { jwkToPublicKey } from '../identity/keyPair';
import { err, ok, type Result } from '../types/result';
import { base45Decode, base45Encode } from './base45';
import { CborTag, cborDecode, cborEncode, cborToJson } from './cbor';

export const CRD1_PREFIX = 'CRD1:';
/** QR v40 · EC level Q · alphanumeric mode capacity. */
export const CRD1_MAX_CHARS = 2420;
/** 30 days — CREDS.md §18 evidence-pack validity. */
export const CRD1_MAX_VALIDITY_SECONDS = 30 * 24 * 60 * 60;

const CLOCK_SKEW_SECONDS = 300;
const COSE_ALG_LABEL = 1;
const COSE_KID_LABEL = 4;
const COSE_ALG_ES256 = -7;
const COSE_SIGN1_TAG = 18;
const SIGNATURE_LENGTH = 64;
const MAX_INFLATED_BYTES = 64 * 1024;

/**
 * Raw-message signer: returns the 64-byte r||s ECDSA-P256 signature over
 * SHA-256(message). See module docstring for the two blessed adapters.
 */
export type Crd1Signer = (message: Uint8Array) => Promise<Uint8Array>;

export interface Crd1Claims {
  /** Issuer DID — must equal the did:key the pack is signed under. */
  readonly iss: string;
  readonly iat: number;
  readonly exp: number;
  readonly [claim: string]: unknown;
}

export type Crd1EncodeOutcome =
  | {
      readonly ok: true;
      readonly wire: string;
      readonly chars: number;
      readonly qrVersion: number;
    }
  | { readonly ok: false; readonly reason: 'over-capacity'; readonly chars: number };

export interface Crd1Decoded {
  /** The verified claims payload (JSON-shaped). */
  readonly claims: Crd1Claims;
  /** The did:key the signature verified against (from the protected kid). */
  readonly did: string;
}

/** Mock v3's char-count → QR-version ladder (`pkSize`), for the meta line. */
export function crd1QrVersion(chars: number): number {
  if (chars < 300) return 11;
  if (chars < 600) return 15;
  if (chars < 1000) return 20;
  if (chars < 1600) return 27;
  if (chars <= CRD1_MAX_CHARS) return 36;
  return 41;
}

/**
 * Sign and encode `claims` into a CRD1 wire. `claims.iss` must equal `did`
 * (one signer, one issuer — a pack that says otherwise is malformed by
 * construction, so this throws rather than returning a Result). `exp` is
 * clamped to `iat + 30d`. Returns `over-capacity` instead of a wire when the
 * result exceeds `CRD1_MAX_CHARS`.
 */
export async function encodeCrd1(
  claims: Crd1Claims,
  did: string,
  sign: Crd1Signer
): Promise<Crd1EncodeOutcome> {
  const body = buildBody(claims, did);
  const protectedBytes = encodeProtectedHeader(did);
  const payloadBytes = cborEncode(body);
  const message = sigStructure(protectedBytes, payloadBytes);
  const signature = await sign(message);
  if (signature.length !== SIGNATURE_LENGTH) {
    throw new Error(
      `crd1: signer must return a ${String(SIGNATURE_LENGTH)}-byte r||s signature (got ${String(signature.length)})`
    );
  }
  return frameWire(protectedBytes, payloadBytes, signature);
}

/**
 * Size a pack WITHOUT signing (no biometric prompt): the signature slot is
 * filled with incompressible payload-derived bytes so the char count matches
 * a real signature's to within a few characters. Drives the live counter and
 * the over-capacity gate in the evidence-pack UI.
 */
export function estimateCrd1(claims: Crd1Claims, did: string): Crd1EncodeOutcome {
  const body = buildBody(claims, did);
  const protectedBytes = encodeProtectedHeader(did);
  const payloadBytes = cborEncode(body);
  const digest = sha256Bytes(payloadBytes);
  const filler = new Uint8Array(SIGNATURE_LENGTH);
  filler.set(digest, 0);
  filler.set(sha256Bytes(digest), 32);
  return frameWire(protectedBytes, payloadBytes, filler);
}

/**
 * Decode and VERIFY a CRD1 wire: base45 → zlib → COSE_Sign1(tag 18) with a
 * protected header of exactly `{alg: ES256, kid: <did>#0}`, ES256 signature
 * over the Sig_structure, `claims.iss === kid`'s did, and a valid ≤30-day
 * `iat`/`exp` window. Never throws — every failure returns `err(reason)`.
 */
export function decodeCrd1(wire: string, now: Date = new Date()): Result<Crd1Decoded, string> {
  const parts = unframeWire(wire);
  if (!parts.ok) return parts;
  const { protectedBytes, payloadBytes, signature } = parts.value;

  const didResult = parseProtectedHeader(protectedBytes);
  if (!didResult.ok) return didResult;
  const did = didResult.value;

  const verified = verifyCoseSignature(did, protectedBytes, payloadBytes, signature);
  if (!verified.ok) return verified;

  const claims = decodeClaimsPayload(payloadBytes);
  if (!claims.ok) return claims;
  const validated = validateClaims(claims.value, did, now);
  if (!validated.ok) return validated;

  return ok({ claims: validated.value, did });
}

interface CoseSign1Parts {
  readonly protectedBytes: Uint8Array;
  readonly payloadBytes: Uint8Array;
  readonly signature: Uint8Array;
}

/** `CRD1:` → base45 → zlib → CBOR tag 18 → the three signed COSE fields. */
function unframeWire(wire: string): Result<CoseSign1Parts, string> {
  if (typeof wire !== 'string' || !wire.startsWith(CRD1_PREFIX)) {
    return err('not a CRD1 wire');
  }
  if (wire.length > CRD1_MAX_CHARS) return err('CRD1 wire exceeds the QR capacity cap');

  let cose: unknown;
  try {
    const compressed = base45Decode(wire.slice(CRD1_PREFIX.length));
    const out = new Uint8Array(MAX_INFLATED_BYTES + 1);
    const written = unzlibSync(compressed, { out });
    if (written.length === 0 || written.length >= MAX_INFLATED_BYTES) {
      return err('CRD1 payload is empty or oversized');
    }
    cose = cborDecode(Uint8Array.from(written));
  } catch (e) {
    return err(`malformed CRD1 wire (${e instanceof Error ? e.message : String(e)})`);
  }

  if (!(cose instanceof CborTag) || cose.tag !== COSE_SIGN1_TAG) {
    return err('CRD1 payload is not a COSE_Sign1 (tag 18)');
  }
  const fields = cose.value;
  if (!Array.isArray(fields) || fields.length !== 4) {
    return err('COSE_Sign1 must be a 4-element array');
  }
  const [protectedBytes, unprotected, payloadBytes, signature] = fields as [
    unknown,
    unknown,
    unknown,
    unknown,
  ];
  if (!(protectedBytes instanceof Uint8Array)) return err('protected header must be a bstr');
  if (!(unprotected instanceof Map) || unprotected.size !== 0) {
    // We never emit unprotected headers; accepting any would let an attacker
    // vary unauthenticated bytes on a "verified" pack.
    return err('unprotected headers must be an empty map');
  }
  if (!(payloadBytes instanceof Uint8Array)) return err('payload must be a bstr');
  if (!(signature instanceof Uint8Array) || signature.length !== SIGNATURE_LENGTH) {
    return err('signature must be 64 raw bytes (r||s)');
  }
  return ok({ protectedBytes, payloadBytes, signature });
}

function verifyCoseSignature(
  did: string,
  protectedBytes: Uint8Array,
  payloadBytes: Uint8Array,
  signature: Uint8Array
): Result<true, string> {
  let publicKey: Uint8Array;
  try {
    publicKey = jwkToPublicKey(resolveDidKey(did));
  } catch (e) {
    return err(`could not resolve did: ${e instanceof Error ? e.message : String(e)}`);
  }

  const digest = sha256Bytes(sigStructure(protectedBytes, payloadBytes));
  // `prehash: false` — the digest above IS the ES256 message representative
  // (same rationale as jws.ts; the default would double-hash). Default lowS
  // rejection stays on.
  if (!p256.verify(signature, digest, publicKey, { prehash: false })) {
    return err('signature verification failed');
  }
  return ok(true);
}

function decodeClaimsPayload(payloadBytes: Uint8Array): Result<Record<string, unknown>, string> {
  let claims: unknown;
  try {
    claims = cborToJson(cborDecode(payloadBytes));
  } catch (e) {
    return err(`malformed claims payload (${e instanceof Error ? e.message : String(e)})`);
  }
  if (typeof claims !== 'object' || claims === null || Array.isArray(claims)) {
    return err('claims payload must be a JSON object');
  }
  return ok(claims as Record<string, unknown>);
}

// ─── Internals ─────────────────────────────────────────────────────────────

function buildBody(claims: Crd1Claims, did: string): Record<string, unknown> {
  if (claims.iss !== did) {
    throw new Error('crd1: claims.iss must equal the signing did');
  }
  if (!Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp)) {
    throw new Error('crd1: iat/exp must be integer epoch seconds');
  }
  const cappedExp = Math.min(claims.exp, claims.iat + CRD1_MAX_VALIDITY_SECONDS);
  if (cappedExp <= claims.iat) throw new Error('crd1: exp must be after iat');
  return { ...claims, exp: cappedExp };
}

function encodeProtectedHeader(did: string): Uint8Array {
  const header = new Map<number, unknown>([
    [COSE_ALG_LABEL, COSE_ALG_ES256],
    [COSE_KID_LABEL, new TextEncoder().encode(`${did}#0`)],
  ]);
  return cborEncode(header);
}

function parseProtectedHeader(protectedBytes: Uint8Array): Result<string, string> {
  let header: unknown;
  try {
    header = cborDecode(protectedBytes);
  } catch {
    return err('protected header is not valid CBOR');
  }
  if (!(header instanceof Map)) return err('protected header must be a map');
  // A bare `instanceof Map` narrows to `Map<any, any>` — pin the value side
  // back to `unknown` so nothing downstream silently trusts attacker input.
  const headerMap = header as ReadonlyMap<unknown, unknown>;
  // Exactness check, same policy as jws.ts's header validation: any member we
  // did not put there (crit, counter-signatures, …) fails closed.
  if (headerMap.size !== 2 || !headerMap.has(COSE_ALG_LABEL) || !headerMap.has(COSE_KID_LABEL)) {
    return err('protected header must contain exactly {alg, kid}');
  }
  if (headerMap.get(COSE_ALG_LABEL) !== COSE_ALG_ES256) {
    return err('unsupported alg (only ES256/-7 is accepted)');
  }
  const kidRaw = headerMap.get(COSE_KID_LABEL);
  if (!(kidRaw instanceof Uint8Array)) return err('kid must be a bstr');
  let kid: string;
  try {
    kid = new TextDecoder('utf-8', { fatal: true }).decode(kidRaw);
  } catch {
    return err('kid is not valid UTF-8');
  }
  if (!kid.startsWith('did:key:') || !kid.endsWith('#0')) {
    return err('kid must be a did:key verification-method id (<did>#0)');
  }
  return ok(kid.slice(0, -2));
}

function sigStructure(protectedBytes: Uint8Array, payloadBytes: Uint8Array): Uint8Array {
  return cborEncode(['Signature1', protectedBytes, new Uint8Array(0), payloadBytes]);
}

function frameWire(
  protectedBytes: Uint8Array,
  payloadBytes: Uint8Array,
  signature: Uint8Array
): Crd1EncodeOutcome {
  const cose = cborEncode(
    new CborTag(COSE_SIGN1_TAG, [
      protectedBytes,
      new Map<number, unknown>(),
      payloadBytes,
      signature,
    ])
  );
  const wire = `${CRD1_PREFIX}${base45Encode(zlibSync(cose, { level: 9 }))}`;
  const chars = wire.length;
  if (chars > CRD1_MAX_CHARS) return { ok: false, reason: 'over-capacity', chars };
  return { ok: true, wire, chars, qrVersion: crd1QrVersion(chars) };
}

function validateClaims(
  raw: Record<string, unknown>,
  did: string,
  now: Date
): Result<Crd1Claims, string> {
  const { iss, iat, exp } = raw;
  if (typeof iss !== 'string' || iss.length === 0) return err('missing iss claim');
  if (iss !== did) {
    // Holder binding at the envelope level: the pack must be issued by the
    // key that signed it — a valid signature under someone ELSE's kid must
    // not vouch for this iss (progress.md: holder-binding class of bugs).
    return err('iss does not match the signing did');
  }
  if (typeof iat !== 'number' || !Number.isSafeInteger(iat)) return err('missing iat claim');
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp)) return err('missing exp claim');

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (iat > nowSeconds + CLOCK_SKEW_SECONDS) return err('pack is not yet valid (iat in the future)');
  if (exp <= nowSeconds) return err('pack has expired');
  if (exp - iat > CRD1_MAX_VALIDITY_SECONDS + CLOCK_SKEW_SECONDS) {
    return err('pack validity exceeds the 30-day cap');
  }
  return ok(raw as Crd1Claims);
}
