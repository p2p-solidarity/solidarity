/**
 * Proof verifier — mirrors Swift ProofVerifierService.swift.
 *
 * Steps:
 *   1. Decode the VC JWT header → extract `kid` (DID URL fragment).
 *   2. Resolve `kid` to a JWK (did:key for now; DID method registry comes later).
 *   3. Verify signature with verifyJwtEs256.
 *   4. Sanity-check claims: `iss`, `nbf`, `exp`, `aud` if provided.
 *
 * Trust level inference moved here from Swift's enum so the UI can render
 * the badge (🟢/🔵/⚪) directly off the verify result.
 */
import {
  decodeJwtUnsafe,
  resolveDidKey,
  type PublicKeyJWK,
  verifyJwtEs256,
} from '@solidarity/shared';

export type TrustLevel = 'L1' | 'L2' | 'L3' | 'L3+';

export interface VerifiedVc {
  readonly issuerDid: string;
  readonly holderDid: string | null;
  readonly trustLevel: TrustLevel;
  readonly claims: Record<string, unknown>;
}

export interface VerifyOptions {
  /** RFC 7519 `aud` value the caller expects to find. */
  readonly expectedAud?: string;
  /** Optional clock override (test-only). */
  readonly now?: number;
}

interface VcClaims {
  readonly iss?: string;
  readonly sub?: string;
  readonly aud?: string | readonly string[];
  readonly iat?: number;
  readonly nbf?: number;
  readonly exp?: number;
  readonly vc?: { readonly credentialSubject?: { readonly id?: string } };
  readonly trustLevel?: TrustLevel;
}

function inferTrust(claims: VcClaims): TrustLevel {
  if (claims.trustLevel) return claims.trustLevel;
  if (claims.iss?.startsWith('did:web:')) return 'L2';
  if (claims.iss?.startsWith('did:key:')) return 'L1';
  return 'L1';
}

function checkTime(claims: VcClaims, now: number): void {
  if (claims.exp !== undefined && now >= claims.exp) {
    throw new Error(`VC expired at ${String(claims.exp)}`);
  }
  if (claims.nbf !== undefined && now < claims.nbf) {
    throw new Error(`VC not yet valid (nbf=${String(claims.nbf)})`);
  }
}

function checkAud(claims: VcClaims, expectedAud?: string): void {
  if (!expectedAud) return;
  const aud = claims.aud;
  if (typeof aud === 'string' ? aud !== expectedAud : !aud?.includes(expectedAud)) {
    throw new Error(`VC aud mismatch (expected ${expectedAud})`);
  }
}

async function resolveIssuerJwk(iss: string): Promise<PublicKeyJWK> {
  if (iss.startsWith('did:key:')) {
    return resolveDidKey(iss);
  }
  throw new Error(`unsupported issuer DID method: ${iss}`);
}

export async function verifyVcJwt(
  jwt: string,
  opts: VerifyOptions = {}
): Promise<VerifiedVc> {
  const { header, payload } = decodeJwtUnsafe<VcClaims>(jwt);
  const iss = payload.iss ?? header.kid?.split('#')[0];
  if (!iss) throw new Error('VC has no issuer (iss / kid)');

  const jwk = await resolveIssuerJwk(iss);
  verifyJwtEs256<VcClaims>(jwt, jwk);

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  checkTime(payload, now);
  checkAud(payload, opts.expectedAud);

  return {
    issuerDid: iss,
    holderDid: payload.sub ?? payload.vc?.credentialSubject?.id ?? null,
    trustLevel: inferTrust(payload),
    claims: payload as unknown as Record<string, unknown>,
  };
}

interface VpClaims {
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly nonce?: string;
  readonly nbf?: number;
  readonly exp?: number;
  readonly vp?: { readonly verifiableCredential?: readonly string[] | string };
}

export interface VerifiedVp {
  readonly holderDid: string;
  readonly credentials: readonly VerifiedVc[];
  readonly nonce?: string;
}

/**
 * Verify a scanned `vp_token` (a holder-signed `vp+jwt`) — the verifier side
 * of OID4VP, mirroring Swift ProofVerifierService.verifyVpToken
 * (QRCodeScanService+Handlers.swift:230). Throws on ANY failure so the caller
 * never shows an unverified presentation as valid:
 *   1. verify the outer VP signature against the holder `did:key`,
 *   2. check the VP's own nbf/exp (+ aud if the caller supplies one),
 *   3. verify EVERY embedded verifiable credential via verifyVcJwt.
 * NOTE: replay/nonce binding to a specific verifier request is out of scope
 * here (a standalone QR scan has no originating request context); signature,
 * expiry, and issuer trust of the embedded VCs are enforced.
 */
export async function verifyVpToken(
  vpJwt: string,
  opts: VerifyOptions = {}
): Promise<VerifiedVp> {
  const { header, payload } = decodeJwtUnsafe<VpClaims>(vpJwt);
  const holder = payload.iss ?? header.kid?.split('#')[0];
  if (!holder) throw new Error('VP has no holder (iss / kid)');

  const jwk = await resolveIssuerJwk(holder);
  verifyJwtEs256<VpClaims>(vpJwt, jwk);

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  checkTime(payload as VcClaims, now);
  checkAud(payload as VcClaims, opts.expectedAud);

  const raw = payload.vp?.verifiableCredential;
  const vcJwts = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (vcJwts.length === 0) throw new Error('VP carries no verifiable credentials');

  const credentials: VerifiedVc[] = [];
  for (const vc of vcJwts) {
    // verifyVcJwt throws if a single embedded credential fails — the whole
    // presentation is then rejected (fail closed).
    credentials.push(await verifyVcJwt(vc, { now: opts.now }));
  }

  return { holderDid: holder, credentials, nonce: payload.nonce };
}
