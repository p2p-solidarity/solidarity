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
import {
  parseSdJwt,
  reconstructSdJwtClaims,
} from '@/credentials/selectiveDisclosure';
import { verifyCardKeyBindingJws } from './cardKeyBinding';

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
  /** Pear-only: root DID authenticated by the channel handshake. */
  readonly expectedRootDid?: string;
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

interface TimedAudClaims {
  readonly aud?: string | readonly string[];
  readonly nbf?: number;
  readonly exp?: number;
}

function inferTrust(claims: VcClaims): TrustLevel {
  if (claims.trustLevel) return claims.trustLevel;
  if (claims.iss?.startsWith('did:web:')) return 'L2';
  if (claims.iss?.startsWith('did:key:')) return 'L1';
  return 'L1';
}

function checkTime(claims: TimedAudClaims, now: number): void {
  if (claims.exp !== undefined && now >= claims.exp) {
    throw new Error(`VC expired at ${String(claims.exp)}`);
  }
  if (claims.nbf !== undefined && now < claims.nbf) {
    throw new Error(`VC not yet valid (nbf=${String(claims.nbf)})`);
  }
}

function checkAud(claims: TimedAudClaims, expectedAud?: string): void {
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
  // An SD-JWT presents as `<issuer-jwt>~<disclosure>~...`. Verify the ISSUER
  // segment's signature (the disclosures are unsigned by design — their
  // digests are what the issuer signed), then reconstruct only the disclosed
  // claims. `reconstructSdJwtClaims` fails closed on any disclosure the issuer
  // never signed (an injected / altered disclosure), so a tampered
  // presentation is rejected rather than silently trusted.
  const isSdJwt = jwt.includes('~');
  let issuerSegment = jwt;
  let disclosures: readonly string[] = [];
  if (isSdJwt) {
    const parsed = parseSdJwt(jwt);
    if (!parsed.ok) throw new Error(parsed.error.message);
    issuerSegment = parsed.value.issuerJwt;
    disclosures = parsed.value.disclosures;
  }

  const { header, payload: issuerPayload } = decodeJwtUnsafe<VcClaims>(issuerSegment);
  const iss = issuerPayload.iss ?? header.kid?.split('#')[0];
  if (!iss) throw new Error('VC has no issuer (iss / kid)');

  const jwk = await resolveIssuerJwk(iss);
  verifyJwtEs256<VcClaims>(issuerSegment, jwk);

  let claims: VcClaims = issuerPayload;
  if (isSdJwt) {
    const reconstructed = reconstructSdJwtClaims(
      issuerPayload as unknown as Record<string, unknown>,
      disclosures,
    );
    if (!reconstructed.ok) throw new Error(reconstructed.error.message);
    claims = reconstructed.value;
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  checkTime(claims, now);
  checkAud(claims, opts.expectedAud);

  return {
    issuerDid: iss,
    holderDid: claims.sub ?? claims.vc?.credentialSubject?.id ?? null,
    trustLevel: inferTrust(claims),
    claims: claims as unknown as Record<string, unknown>,
  };
}

interface VpClaims {
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly nonce?: string;
  readonly nbf?: number;
  readonly exp?: number;
  readonly vp?: { readonly verifiableCredential?: readonly string[] | string };
  readonly solidarity?: { readonly cardKeyBinding?: string };
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
  checkTime(payload, now);
  checkAud(payload, opts.expectedAud);

  if (opts.expectedRootDid) {
    const bindingJws = payload.solidarity?.cardKeyBinding;
    if (typeof bindingJws !== 'string' || bindingJws.length === 0) {
      throw new Error('VP missing card-key binding for expected root DID');
    }
    verifyCardKeyBindingJws(bindingJws, {
      expectedRootDid: opts.expectedRootDid,
      expectedCardDid: holder,
      expectedAud: opts.expectedAud,
      expectedNonce: payload.nonce,
      now,
    });
  }

  const raw = payload.vp?.verifiableCredential;
  const vcJwts = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  if (vcJwts.length === 0) throw new Error('VP carries no verifiable credentials');

  const credentials: VerifiedVc[] = [];
  for (const vc of vcJwts) {
    // verifyVcJwt throws if a single embedded credential fails — the whole
    // presentation is then rejected (fail closed).
    const verified = await verifyVcJwt(vc, { now: opts.now });
    // HOLDER BINDING: an embedded VC must be bound to the SAME holder that
    // signed the outer VP (`verified.holderDid`, from the VC's own
    // `sub`/`credentialSubject.id`, must equal `holder`, the VP's own
    // self-certifying `iss`/`kid`). Without this check, whoever controls
    // the VP-signing key could wrap ANY credential JWT they merely hold a
    // copy of — including one legitimately issued to and bound to a
    // DIFFERENT holder — and have it accepted as their own presentation.
    // That's the exact "presenting someone else's credential" attack
    // holder binding exists to prevent; it is self-contained (no
    // caller-supplied `expectedHolder` needed) so it protects every
    // caller of `verifyVpToken` — the QR-scan verify path
    // (`app/scan/index.tsx`) and A5.3's Pear-channel verify alike — not
    // just one call site. A VC with no holder claim at all
    // (`holderDid === null`) also fails this (never strictly equals a
    // real did string), which is correct: an unbound credential proves
    // nothing about who may present it.
    if (verified.holderDid !== holder) {
      throw new Error(
        `VP embeds a credential bound to a different holder (VP holder ${holder}, credential holder ${String(verified.holderDid)})`
      );
    }
    credentials.push(verified);
  }

  return { holderDid: holder, credentials, nonce: payload.nonce };
}
