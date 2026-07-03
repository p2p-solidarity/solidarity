import { utf8ToBytes } from '@solidarity/shared';

import { compressForQR } from '@/cards/qrCompression';
import { stableStringify } from '@/cards/solidarityQrTypes';
import type { StoredCredential } from '@/credentials/store';
import type { ProvableClaimEntity } from '@/identity/entities';
import {
  buildPresentationQrPages,
  type BuildPresentationQrPagesOptions,
  type PresentationQRPage,
} from '@/me/presentationQrPages';

export type PresentationCredential = Pick<
  StoredCredential,
  'id' | 'holderDid' | 'rawJwt' | 'metadataTags'
>;

export interface BuildPresentationProofInput {
  readonly credential: PresentationCredential;
  readonly selectedClaims: readonly ProvableClaimEntity[];
  readonly nonce?: string;
}

export function initialPresentationClaimIds(
  claims: readonly ProvableClaimEntity[],
  preferredClaimId?: string,
): ReadonlySet<string> {
  if (preferredClaimId && claims.some((claim) => claim.id === preferredClaimId)) {
    return new Set([preferredClaimId]);
  }
  return new Set(claims.map((claim) => claim.id));
}

export function selectPresentationClaims(
  claims: readonly ProvableClaimEntity[],
  selectedClaimIds: ReadonlySet<string>,
): readonly ProvableClaimEntity[] {
  if (selectedClaimIds.size === 0) return [];
  return claims.filter((claim) => selectedClaimIds.has(claim.id));
}

export function isPresentationDisabled(
  selectedClaimIds: ReadonlySet<string>,
): boolean {
  return selectedClaimIds.size === 0;
}

export function presentedClaimIds(
  claims: readonly ProvableClaimEntity[],
  selectedClaimIds: ReadonlySet<string>,
): readonly string[] {
  return selectPresentationClaims(claims, selectedClaimIds).map((claim) => claim.id);
}

export function resolvedProofTypeTag(
  metadataTags: readonly string[],
): 'mopro-noir' | 'semaphore-zk' | 'sd-jwt-fallback' {
  if (metadataTags.includes('mopro-noir')) return 'mopro-noir';
  if (metadataTags.includes('semaphore-zk')) return 'semaphore-zk';
  return 'sd-jwt-fallback';
}

export function buildPresentationProofJson({
  credential,
  selectedClaims,
  nonce = cryptoNonce(),
}: BuildPresentationProofInput): string {
  return stableStringify({
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    holder: credential.holderDid,
    nonce,
    proof_type: resolvedProofTypeTag(credential.metadataTags),
    selected_claims: selectedClaims.map((claim) => claim.claimType),
    type: ['VerifiablePresentation'],
    verifiableCredential: [parseRawCredential(credential.rawJwt)],
  });
}

export function buildPresentationProofPayload(
  input: BuildPresentationProofInput,
): string {
  const json = buildPresentationProofJson(input);
  return compressForQR(utf8ToBytes(json)) ?? json;
}

export function buildPresentationProofQrPages(
  input: BuildPresentationProofInput,
  options?: BuildPresentationQrPagesOptions,
): readonly PresentationQRPage[] {
  return buildPresentationQrPages(buildPresentationProofPayload(input), options);
}

function parseRawCredential(rawCredential: string): unknown {
  try {
    return JSON.parse(rawCredential) as unknown;
  } catch {
    return rawCredential;
  }
}

/** Cryptographically-random hex nonce. Exported so other presentation
 *  builders (`pear/presentBuilder.ts`, A5.3) can mint a fresh per-request
 *  nonce without duplicating this fallback logic. */
export function cryptoNonce(): string {
  const arr = new Uint8Array(16);
  try {
    crypto.getRandomValues(arr);
  } catch {
    for (let i = 0; i < arr.length; i += 1) {
      arr[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
}
