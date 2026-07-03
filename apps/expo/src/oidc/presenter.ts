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

export interface PresentationBuilderDeps {
  readonly publicJwk?: () => Promise<PublicKeyJWK>;
  readonly signJwt?: PresentationSigner;
  readonly getProvableClaims?: () =>
    | readonly ProvableClaimEntity[]
    | Promise<readonly ProvableClaimEntity[]>;
  readonly getCredentials?: () =>
    | ReadonlyMap<string, { readonly id: string; readonly rawJwt: string }>
    | Promise<ReadonlyMap<string, { readonly id: string; readonly rawJwt: string }>>;
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
  ReadonlyMap<string, { readonly id: string; readonly rawJwt: string }>
> {
  const { useCredentialStore } = await import('@/credentials/store');
  return useCredentialStore.getState().details;
}

async function rawCredentialIdsFor(
  claimIds: readonly string[],
  deps: PresentationBuilderDeps | undefined,
): Promise<readonly string[]> {
  if (claimIds.length === 0) return [];
  const claims = await (deps?.getProvableClaims?.() ?? defaultProvableClaims());
  const credentials = await (deps?.getCredentials?.() ?? defaultCredentialDetails());
  const claimById = new Map<string, ProvableClaimEntity>(claims.map((c) => [c.id, c]));
  const cardIds = new Set<string>();
  const directCredentialIds = new Set<string>();
  for (const id of claimIds) {
    const claim = claimById.get(id);
    if (claim) {
      cardIds.add(claim.identityCardId);
    } else {
      directCredentialIds.add(id);
    }
  }
  const jwts: string[] = [];
  for (const c of credentials.values()) {
    if (cardIds.has(c.id) || directCredentialIds.has(c.id)) {
      jwts.push(c.rawJwt);
    }
  }
  return jwts;
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

export async function buildVpToken(
  input: PresentationBuilderInput
): Promise<Result<BuiltPresentation, OidcError>> {
  const vcJwts = await rawCredentialIdsFor(input.selectedClaimIds, input.deps);
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
  let cardKeyBindingJws: string | undefined;
  if (input.cardKeyBinding) {
    try {
      cardKeyBindingJws = await buildCardKeyBindingJws({
        rootDid: input.cardKeyBinding.rootDid,
        cardDid: derivedDid,
        audienceDid: audience,
        nonce,
        sign: input.cardKeyBinding.sign,
        now,
        lifetimeSeconds: VP_LIFETIME_SECONDS,
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      return err(oidcError('cryptographicError', `Failed to sign card-key binding: ${m}`));
    }
  }

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
