import { err, ok, type Result, utf8ToBytes } from '@solidarity/shared';

import { compressForQR } from '@/cards/qrCompression';
import { stableStringify } from '@/cards/solidarityQrTypes';
import {
  classifyCredentialFormat,
  disclosureError,
  type DisclosureError,
  selectSdJwtDisclosures,
} from '@/credentials/selectiveDisclosure';
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
  /**
   * ALL presentable claims this credential backs. Required to tell a FULL
   * disclosure from a strict subset for an ordinary (atomic) JWT VC — a
   * subset of such a credential cannot be presented without leaking the
   * unselected claims, so it fails closed. When omitted, an ordinary JWT VC
   * is treated conservatively as a subset (fail closed).
   */
  readonly allClaims?: readonly ProvableClaimEntity[];
  readonly nonce?: string;
}

export function initialPresentationClaimIds(
  claims: readonly ProvableClaimEntity[],
  preferredClaimId?: string,
): ReadonlySet<string> {
  if (preferredClaimId !== undefined) {
    return claims.some((claim) => claim.id === preferredClaimId)
      ? new Set([preferredClaimId])
      : new Set();
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

/**
 * Build the presentation JSON, refusing to leak a full credential when the
 * user selected only a subset. Behaviour is decided by the credential's real
 * on-disk shape, not a metadata tag:
 *
 *   - ZK proof (`mopro-noir` / `semaphore-zk`): the embedded artifact IS the
 *     proof — it carries no raw claim fields to leak — so `selected_claims`
 *     next to it is honest. Unchanged shape.
 *   - real SD-JWT: emit a REDACTED SD-JWT (only the selected disclosures);
 *     the full credential is never embedded.
 *   - ordinary JWT VC (atomic): a strict subset is impossible without forging
 *     a self-assertion → fail closed. Only a FULL disclosure is embedded, and
 *     then it is labelled `disclosure: 'full'` with NO `selected_claims`, so a
 *     verifier is never told a whole credential was "selectively disclosed".
 *
 * A credential that failed import signature verification (`unverified` tag) is
 * never presentable as evidence — fail closed.
 */
export function buildPresentationProofJson(
  input: BuildPresentationProofInput,
): Result<string, DisclosureError> {
  const { credential, selectedClaims, allClaims, nonce = cryptoNonce() } = input;

  if (credential.metadataTags.includes('unverified')) {
    return err(
      disclosureError(
        'not-redactable',
        'Credential is unverified (issuer signature not checked) and cannot be presented as evidence',
      ),
    );
  }

  const base = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    holder: credential.holderDid,
    nonce,
    proof_type: resolvedProofTypeTag(credential.metadataTags),
    type: ['VerifiablePresentation'],
  } as const;

  const format = classifyCredentialFormat(credential.rawJwt);

  if (format === 'sd-jwt') {
    const selectedNames = new Set(selectedClaims.map((claim) => claim.claimType));
    const redacted = selectSdJwtDisclosures(credential.rawJwt, selectedNames);
    if (!redacted.ok) return redacted;
    return ok(
      stableStringify({
        ...base,
        disclosure: 'subset',
        selected_claims: selectedClaims.map((claim) => claim.claimType),
        sd_jwt: redacted.value,
      }),
    );
  }

  if (format === 'jwt-vc') {
    if (!isFullDisclosure(selectedClaims, allClaims)) {
      return err(
        disclosureError(
          'not-redactable',
          'Ordinary JWT credential cannot disclose a subset of its claims without leaking the rest',
        ),
      );
    }
    // Full, honest disclosure of the whole credential — no `selected_claims`
    // field, so it is never mistaken for a redacted subset.
    return ok(
      stableStringify({
        ...base,
        disclosure: 'full',
        verifiableCredential: [parseRawCredential(credential.rawJwt)],
      }),
    );
  }

  if (format === 'zk-proof') {
    // The proof object itself IS the disclosure — it carries no raw claim
    // fields to leak, so pairing it with `selected_claims` is honest.
    return ok(
      stableStringify({
        ...base,
        selected_claims: selectedClaims.map((claim) => claim.claimType),
        verifiableCredential: [parseRawCredential(credential.rawJwt)],
      }),
    );
  }

  // 'opaque': an unstructured blob we cannot prove a subset of. Emitting its
  // raw bytes beside a `selected_claims` label would imply a redaction we did
  // not perform — refuse, matching `buildVpToken`'s fail-closed default.
  return err(
    disclosureError(
      'not-redactable',
      'Credential format is unrecognized and cannot be presented as selective evidence',
    ),
  );
}

/** Every backing claim is selected → the whole (atomic) credential is being
 *  disclosed on purpose. Missing `allClaims` is treated as "cannot prove full"
 *  → fail closed. */
function isFullDisclosure(
  selectedClaims: readonly ProvableClaimEntity[],
  allClaims: readonly ProvableClaimEntity[] | undefined,
): boolean {
  if (!allClaims) return false;
  if (allClaims.length === 0) return false;
  const selectedIds = new Set(selectedClaims.map((claim) => claim.id));
  return allClaims.every((claim) => selectedIds.has(claim.id));
}

export function buildPresentationProofPayload(
  input: BuildPresentationProofInput,
): Result<string, DisclosureError> {
  const json = buildPresentationProofJson(input);
  if (!json.ok) return json;
  return ok(compressForQR(utf8ToBytes(json.value)) ?? json.value);
}

export function buildPresentationProofQrPages(
  input: BuildPresentationProofInput,
  options?: BuildPresentationQrPagesOptions,
): Result<readonly PresentationQRPage[], DisclosureError> {
  const payload = buildPresentationProofPayload(input);
  if (!payload.ok) return payload;
  return ok(buildPresentationQrPages(payload.value, options));
}

/** Map a disclosure-refusal to a flat i18n key so both presentation surfaces
 *  render one honest, localized reason (never a raw developer message). */
export function disclosureErrorI18nKey(
  error: DisclosureError,
): string {
  switch (error.code) {
    case 'unsatisfiable':
      return 'credentialDetail.disclosureUnsatisfiable';
    case 'altered-disclosure':
      return 'credentialDetail.disclosureAltered';
    case 'malformed':
      return 'credentialDetail.disclosureMalformed';
    case 'not-redactable':
    default:
      return error.message.includes('unverified')
        ? 'credentialDetail.disclosureUnverified'
        : 'credentialDetail.disclosureNotRedactable';
  }
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
