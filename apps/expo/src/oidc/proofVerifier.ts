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

export type TrustLevel = 'L1' | 'L2' | 'L3';

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
