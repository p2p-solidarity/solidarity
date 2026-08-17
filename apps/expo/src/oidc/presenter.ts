/**
 * OID4VP Presenter — TS port of
 * solidarity/Services/Identity/OID4VPPresentationService.swift (`wrapCredentialsAsVP`).
 *
 * Builds the holder side of an OID4VP exchange:
 *   1. Collect VC JWTs from the selected provable claims (or, when the
 *      caller passes credential ids directly, from the credentials store).
 *   2. Wrap them in a `vp+jwt` envelope whose payload mirrors the Swift
 *      shape exactly:
 *
 *        header  = { alg: ES256, typ: vp+jwt, kid: <vmId> }
 *        payload = {
 *          iss: holderDid,
 *          sub: holderDid,
 *          iat, exp,
 *          aud: request.client_id,
 *          nonce: request.nonce,
 *          vp: {
 *            "@context": ["https://www.w3.org/2018/credentials/v1"],
 *            type: ["VerifiablePresentation"],
 *            holder: holderDid,
 *            verifiableCredential: [<vc-jwt>, ...]
 *          }
 *        }
 *   3. Sign with the active SE-backed signing key via `signJwt`.
 *   4. Construct the DIF `presentation_submission` descriptor map so the
 *      verifier can match the VP back to its input_descriptor ids.
 */
import {
  didKeyFromJwk,
  err,
  ok,
  type PublicKeyJWK,
  type Result,
  type Signer,
} from '@solidarity/shared';

import {
  classifyCredentialFormat,
  selectSdJwtDisclosures,
} from '@/credentials/selectiveDisclosure';
import type { ProvableClaimEntity } from '@/identity';

import { oidcError, type OidcError } from './errors';
import type { ParsedOidcRequest } from './parseAuthRequest';
import { buildCardKeyBindingJws } from './cardKeyBinding';

const VP_LIFETIME_SECONDS = 300;

export interface PresentationSubmissionDescriptor {
  readonly id: string;
  readonly format: 'jwt_vp' | 'jwt_vc';
  readonly path: string;
  readonly path_nested?: PresentationSubmissionDescriptor;
}

export interface PresentationSubmission {
  readonly id: string;
  readonly definition_id: string;
  readonly descriptor_map: readonly PresentationSubmissionDescriptor[];
}

type PresentationSigner = (
  header: { readonly alg: 'ES256'; readonly typ?: string; readonly kid?: string },
  payload: Record<string, unknown>,
) => Promise<string>;

export interface PresentationCredentialDetail {
  readonly id: string;
  readonly rawJwt: string;
  /** Import-verification + format tags. A credential tagged `unverified`
   *  (issuer signature not checked on import) is never presentable. */
  readonly metadataTags?: readonly string[];
}

export interface PresentationBuilderDeps {
  readonly publicJwk?: () => Promise<PublicKeyJWK>;
  readonly signJwt?: PresentationSigner;
  readonly getProvableClaims?: () =>
    | readonly ProvableClaimEntity[]
    | Promise<readonly ProvableClaimEntity[]>;
  readonly getCredentials?: () =>
    | ReadonlyMap<string, PresentationCredentialDetail>
    | Promise<ReadonlyMap<string, PresentationCredentialDetail>>;
  readonly nowSeconds?: () => number;
}

export interface PresentationBuilderInput {
  readonly request: ParsedOidcRequest;
  /** Provable-claim ids OR credential ids (we look in both stores). */
  readonly selectedClaimIds: readonly string[];
  readonly holderDid: string;
  /** Pear-only: root key authorization that anchors the card-signing DID. */
  readonly cardKeyBinding?: {
    readonly rootDid: string;
    readonly sign: Signer;
  };
  readonly deps?: PresentationBuilderDeps;
}

export interface BuiltPresentation {
  readonly vpJwt: string;
  readonly presentationSubmission: PresentationSubmission;
  readonly state?: string;
}

async function defaultPublicJwk(): Promise<PublicKeyJWK> {
  const { publicJwk } = await import('@/keychain/signingKey');
  return publicJwk();
}

async function defaultSignJwt(
  header: { readonly alg: 'ES256'; readonly typ?: string; readonly kid?: string },
  payload: Record<string, unknown>,
): Promise<string> {
  const { signJwt } = await import('@/keychain/signingKey');
  return signJwt(header, payload);
}

async function defaultProvableClaims(): Promise<readonly ProvableClaimEntity[]> {
  const { useIdentityData } = await import('@/identity');
  return useIdentityData.getState().provableClaims;
}

async function defaultCredentialDetails(): Promise<
  ReadonlyMap<string, PresentationCredentialDetail>
> {
  const { useCredentialStore } = await import('@/credentials/store');
  return useCredentialStore.getState().details;
}

/**
 * Resolve the selected claim ids to the ACTUAL wire artifacts to embed in the
 * VP — never the raw credential when that would over-disclose. Mirrors the
 * `presentationProof.ts` honesty rules so both presentation surfaces behave
 * identically:
 *
 *   - ordinary JWT VC + a strict subset of its claims → FAIL CLOSED (a plain
 *     JWT is atomic; embedding it verbatim leaks the unselected claims).
 *   - ordinary JWT VC fully disclosed (all its presentable claims selected, or
 *     the credential itself was selected directly) → embed as-is.
 *   - real SD-JWT + subset → embed a REDACTED SD-JWT (selected disclosures
 *     only); full → embed as-is.
 *   - ZK proof / non-JWT credential → refuse (cannot form a verifiable OID4VP
 *     `verifiableCredential` entry a verifier can parse).
 *   - `unverified`-tagged credential → refuse (import signature never checked).
 */
interface SelectionIndex {
  readonly presentableByCard: ReadonlyMap<string, readonly ProvableClaimEntity[]>;
  readonly cardIds: ReadonlySet<string>;
  readonly directCredentialIds: ReadonlySet<string>;
  readonly selectedIds: ReadonlySet<string>;
}

/** Group presentable claims per card and split the selected ids into
 *  claim-backed cards vs. directly-selected credential ids. */
function indexSelection(
  claims: readonly ProvableClaimEntity[],
  claimIds: readonly string[],
): SelectionIndex {
  const claimById = new Map<string, ProvableClaimEntity>(claims.map((c) => [c.id, c]));
  const presentableByCard = new Map<string, ProvableClaimEntity[]>();
  for (const claim of claims) {
    if (!claim.isPresentable) continue;
    const bucket = presentableByCard.get(claim.identityCardId) ?? [];
    bucket.push(claim);
    presentableByCard.set(claim.identityCardId, bucket);
  }
  const cardIds = new Set<string>();
  const directCredentialIds = new Set<string>();
  for (const id of claimIds) {
    const claim = claimById.get(id);
    if (claim) cardIds.add(claim.identityCardId);
    else directCredentialIds.add(id);
  }
  return { presentableByCard, cardIds, directCredentialIds, selectedIds: new Set(claimIds) };
}

async function collectPresentedCredentials(
  claimIds: readonly string[],
  deps: PresentationBuilderDeps | undefined,
): Promise<Result<readonly string[], OidcError>> {
  if (claimIds.length === 0) return ok([]);
  const claims = await (deps?.getProvableClaims?.() ?? defaultProvableClaims());
  const credentials = await (deps?.getCredentials?.() ?? defaultCredentialDetails());
  const index = indexSelection(claims, claimIds);

  const jwts: string[] = [];
  for (const cred of credentials.values()) {
    const isDirect = index.directCredentialIds.has(cred.id);
    if (!isDirect && !index.cardIds.has(cred.id)) continue;
    const cardClaims = index.presentableByCard.get(cred.id) ?? [];
    const resolved = resolveEmbeddedCredential(cred, {
      full: isDirect || isFullCardDisclosure(cardClaims, index.selectedIds),
      selectedNames: cardClaims
        .filter((c) => index.selectedIds.has(c.id))
        .map((c) => c.claimType),
    });
    if (!resolved.ok) return resolved;
    jwts.push(resolved.value);
  }
  return ok(jwts);
}

/** Decide the exact wire artifact for ONE selected credential, honestly (see
 *  `collectPresentedCredentials`). Returns the JWT/SD-JWT string to embed, or a
 *  fail-closed `OidcError`. */
function resolveEmbeddedCredential(
  cred: PresentationCredentialDetail,
  disclosure: { readonly full: boolean; readonly selectedNames: readonly string[] },
): Result<string, OidcError> {
  if ((cred.metadataTags ?? []).includes('unverified')) {
    return err(
      oidcError(
        'invalidRequest',
        'Refusing to present an unverified credential (issuer signature not checked on import)',
      ),
    );
  }

  const format = classifyCredentialFormat(cred.rawJwt);

  if (format === 'jwt-vc') {
    return disclosure.full
      ? ok(cred.rawJwt)
      : err(
          oidcError(
            'invalidRequest',
            'Selective disclosure of an ordinary JWT credential is not supported — presenting it would leak the unselected claims',
          ),
        );
  }

  if (format === 'sd-jwt') {
    if (disclosure.full) return ok(cred.rawJwt);
    const redacted = selectSdJwtDisclosures(cred.rawJwt, new Set(disclosure.selectedNames));
    return redacted.ok
      ? ok(redacted.value)
      : err(oidcError('invalidRequest', `SD-JWT disclosure failed: ${redacted.error.message}`));
  }

  return err(
    oidcError(
      'invalidRequest',
      'Credential cannot be presented in an OID4VP presentation (not a verifiable JWT credential)',
    ),
  );
}

/** A full disclosure of an atomic credential: every presentable claim it backs
 *  is selected. An unknown/empty presentable set can't prove "full" → false. */
function isFullCardDisclosure(
  cardClaims: readonly ProvableClaimEntity[],
  selectedIds: ReadonlySet<string>,
): boolean {
  if (cardClaims.length === 0) return false;
  return cardClaims.every((claim) => selectedIds.has(claim.id));
}

function buildPresentationSubmission(
  request: ParsedOidcRequest,
  vcCount: number
): PresentationSubmission {
  const pd = request.request.presentation_definition;
  const definitionId = pd?.id ?? 'default-request';
  const descriptors: PresentationSubmissionDescriptor[] = [];
  const inputDescriptors = pd?.input_descriptors ?? [];
  for (let i = 0; i < inputDescriptors.length; i += 1) {
    const d = inputDescriptors[i];
    if (!d) continue;
    descriptors.push({
      id: d.id,
      format: 'jwt_vp',
      path: '$',
      path_nested: {
        id: d.id,
        format: 'jwt_vc',
        path: `$.vp.verifiableCredential[${String(Math.min(i, Math.max(0, vcCount - 1)))}]`,
      },
    });
  }
  if (descriptors.length === 0) {
    descriptors.push({
      id: 'business-card',
      format: 'jwt_vp',
      path: '$',
      path_nested: {
        id: 'business-card',
        format: 'jwt_vc',
        path: '$.vp.verifiableCredential[0]',
      },
    });
  }
  return {
    id: `ps-${String(Date.now())}`,
    definition_id: definitionId,
    descriptor_map: descriptors,
  };
}

/** Sign the Pear root→card binding when the caller supplies one; a plain
 *  OID4VP flow has no binding and returns `undefined`. Fail-closed on signer
 *  errors. */
async function signCardKeyBinding(
  input: PresentationBuilderInput,
  cardDid: string,
  audienceDid: string,
  nonce: string,
  now: number,
): Promise<Result<string | undefined, OidcError>> {
  if (!input.cardKeyBinding) return ok(undefined);
  try {
    const jws = await buildCardKeyBindingJws({
      rootDid: input.cardKeyBinding.rootDid,
      cardDid,
      audienceDid,
      nonce,
      sign: input.cardKeyBinding.sign,
      now,
      lifetimeSeconds: VP_LIFETIME_SECONDS,
    });
    return ok(jws);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('cryptographicError', `Failed to sign card-key binding: ${m}`));
  }
}

export async function buildVpToken(
  input: PresentationBuilderInput
): Promise<Result<BuiltPresentation, OidcError>> {
  const collected = await collectPresentedCredentials(input.selectedClaimIds, input.deps);
  if (!collected.ok) return collected;
  const vcJwts = collected.value;
  if (vcJwts.length === 0) {
    return err(oidcError('invalidRequest', 'No credentials selected for presentation'));
  }

  let derivedDid: string;
  let verificationMethodId: string;
  try {
    const jwk = await (input.deps?.publicJwk ?? defaultPublicJwk)();
    derivedDid = didKeyFromJwk(jwk);
    verificationMethodId = `${derivedDid}#${derivedDid.slice('did:key:'.length)}`;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('keyManagement', `Failed to resolve signing key: ${m}`));
  }

  // Use the derived DID for binding even when the caller passed a different
  // value (matches Swift: the active key's `did:key` is canonical).
  void input.holderDid;

  const now = input.deps?.nowSeconds?.() ?? Math.floor(Date.now() / 1000);
  const audience = input.request.request.client_id;
  const nonce = input.request.request.nonce;
  const binding = await signCardKeyBinding(input, derivedDid, audience, nonce, now);
  if (!binding.ok) return binding;
  const cardKeyBindingJws = binding.value;

  const payload: Record<string, unknown> = {
    iss: derivedDid,
    sub: derivedDid,
    iat: now,
    exp: now + VP_LIFETIME_SECONDS,
    aud: audience,
    nonce,
    vp: {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      holder: derivedDid,
      verifiableCredential: vcJwts,
    },
    ...(cardKeyBindingJws ? { solidarity: { cardKeyBinding: cardKeyBindingJws } } : {}),
  };

  let vpJwt: string;
  try {
    vpJwt = await (input.deps?.signJwt ?? defaultSignJwt)(
      { alg: 'ES256', typ: 'vp+jwt', kid: verificationMethodId },
      payload
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('cryptographicError', `Failed to sign VP token: ${m}`));
  }

  const presentationSubmission = buildPresentationSubmission(input.request, vcJwts.length);
  const state = input.request.request.state;
  return ok({
    vpJwt,
    presentationSubmission,
    ...(state ? { state } : {}),
  });
}
