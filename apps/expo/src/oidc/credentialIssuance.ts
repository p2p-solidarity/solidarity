/**
 * CredentialIssuanceService — TS port of the OID4VCI orchestrator in
 * solidarity/Services/OIDC/CredentialIssuanceService.swift and the
 * proof builder in `+Proof.swift`.
 *
 * Public surface mirrors the Swift contract:
 *   - `parseCredentialOffer(url)`        → Swift `parseOffer`
 *   - `fetchIssuerMetadata(issuerUrl)`   → Swift `fetchIssuerMetadata`
 *   - `requestCredential({offer, metadata, holderDid})` runs the
 *     three-step ceremony: token exchange → proof-of-possession JWT →
 *     credential request, and persists the result via the existing
 *     credentials store.
 *
 * Wire format matches Swift verbatim:
 *   - Proof header: `{ alg: ES256, typ: openid4vci-proof+jwt, kid: <vmId> }`
 *   - Proof payload: `{ iss: holderDid, aud: issuer, iat, exp, nonce? }`
 *   - Credential request: `proofs.jwt[…]` + legacy `proof.jwt` + `format`
 *     + `credential_definition.type`, with `credential_identifier` taking
 *     precedence over `credential_configuration_id` when the token
 *     response carried authorization_details.
 */
import { decodeJwtUnsafe, didKeyFromJwk, err, ok, type Result } from '@solidarity/shared';

import {
  publicJwk,
  signJwt,
} from '@/keychain/signingKey';
import { useCredentialStore, type StoredCredential } from '@/credentials/store';

import {
  type CredentialOffer,
  fetchCredentialOffer,
  parseCredentialOffer,
  type TxCodeSpec,
} from './credentialOffer';
import { oidcError, type OidcError } from './errors';
import { requestToken, type TokenResponse } from './tokenService';

export type { CredentialOffer, TxCodeSpec };
export { fetchCredentialOffer, parseCredentialOffer };

export interface IssuerMetadata {
  readonly credentialEndpoint: string;
  readonly tokenEndpoint: string;
  readonly deferredCredentialEndpoint?: string;
  readonly authorizationServer?: string;
  readonly nonceEndpoint?: string;
  readonly credentialsSupported?: Record<string, unknown>;
}

export interface RequestCredentialOpts {
  readonly offer: CredentialOffer;
  readonly metadata: IssuerMetadata;
  readonly holderDid: string;
  readonly userPin?: string;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const PROOF_LIFETIME_SECONDS = 300;

// MARK: - Issuer metadata

interface RawIssuerMetadata {
  readonly credential_endpoint?: string;
  readonly token_endpoint?: string;
  readonly deferred_credential_endpoint?: string;
  readonly nonce_endpoint?: string;
  readonly authorization_servers?: readonly string[];
  readonly authorization_server?: string;
  readonly credentials_supported?: Record<string, unknown>;
}

async function resolveAuthorizationServerTokenEndpoint(
  asUrl: string,
  fetchImpl: typeof fetch
): Promise<string | undefined> {
  try {
    const discoveryUrl = `${asUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const response = await fetchImpl(discoveryUrl);
    if (!response.ok) return undefined;
    const json = (await response.json()) as { readonly token_endpoint?: string };
    return typeof json.token_endpoint === 'string' ? json.token_endpoint : undefined;
  } catch {
    return undefined;
  }
}

export async function fetchIssuerMetadata(
  issuerUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<Result<IssuerMetadata, OidcError>> {
  const metadataUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-credential-issuer`;
  try {
    const response = await fetchImpl(metadataUrl);
    if (!response.ok) {
      return err(
        oidcError(
          'metadataFetchFailed',
          `Issuer metadata returned HTTP ${String(response.status)}`,
          response.status
        )
      );
    }
    const json = (await response.json()) as RawIssuerMetadata;
    if (typeof json.credential_endpoint !== 'string') {
      return err(oidcError('metadataFetchFailed', 'Issuer metadata missing credential_endpoint'));
    }
    let tokenEndpoint = typeof json.token_endpoint === 'string' ? json.token_endpoint : undefined;
    const asUrl =
      json.authorization_servers?.[0] ??
      (typeof json.authorization_server === 'string' ? json.authorization_server : undefined);
    if (!tokenEndpoint && asUrl) {
      tokenEndpoint = await resolveAuthorizationServerTokenEndpoint(asUrl, fetchImpl);
    }
    if (!tokenEndpoint) {
      tokenEndpoint = `${issuerUrl.replace(/\/$/, '')}/token`;
    }
    return ok({
      credentialEndpoint: json.credential_endpoint,
      tokenEndpoint,
      ...(typeof json.deferred_credential_endpoint === 'string'
        ? { deferredCredentialEndpoint: json.deferred_credential_endpoint }
        : {}),
      ...(asUrl ? { authorizationServer: asUrl } : {}),
      ...(typeof json.nonce_endpoint === 'string' ? { nonceEndpoint: json.nonce_endpoint } : {}),
      ...(json.credentials_supported ? { credentialsSupported: json.credentials_supported } : {}),
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('networkError', `Issuer metadata fetch failed: ${m}`));
  }
}

// MARK: - Nonce endpoint (OID4VCI final §7.2)

async function fetchFreshCNonce(
  endpoint: string,
  fetchImpl: typeof fetch
): Promise<string | undefined> {
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    if (!response.ok) return undefined;
    const json = (await response.json()) as { readonly c_nonce?: string };
    return typeof json.c_nonce === 'string' && json.c_nonce.length > 0 ? json.c_nonce : undefined;
  } catch {
    return undefined;
  }
}

// MARK: - Proof of possession

interface ProofPayload {
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly exp: number;
  readonly nonce?: string;
}

async function buildProofJwt(
  issuerUrl: string,
  holderDid: string,
  cNonce: string | undefined
): Promise<Result<string, OidcError>> {
  try {
    const jwk = await publicJwk();
    const derivedDid = didKeyFromJwk(jwk);
    // The active signing key derives the holder DID; if the caller passed a
    // different value we still use the active DID as `iss` so the proof
    // verifies against the same key the verifier resolves from `kid`.
    const iss = derivedDid;
    const verificationMethodId = `${iss}#${iss.slice('did:key:'.length)}`;
    const now = Math.floor(Date.now() / 1000);
    const payload: ProofPayload = {
      iss,
      aud: issuerUrl,
      iat: now,
      exp: now + PROOF_LIFETIME_SECONDS,
      ...(cNonce ? { nonce: cNonce } : {}),
    };
    const jws = await signJwt(
      { alg: 'ES256', typ: 'openid4vci-proof+jwt', kid: verificationMethodId },
      payload as unknown as Record<string, unknown>
    );
    // Silence unused-arg lint — holderDid is part of the public contract but
    // the active key is canonical. Future multi-DID wallets can route here.
    void holderDid;
    return ok(jws);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('cryptographicError', `Failed to build proof of possession: ${m}`));
  }
}

// MARK: - Credential request

interface CredentialResponseBatchEntry {
  readonly credential?: string;
  readonly format?: string;
}

interface RawCredentialResponse {
  readonly credential?: string;
  readonly format?: string;
  readonly c_nonce?: string;
  readonly c_nonce_expires_in?: number;
  readonly notification_id?: string;
  readonly credentials?: readonly CredentialResponseBatchEntry[];
  readonly transaction_id?: string;
  readonly error?: string;
}

function extractCredentialIdentifiers(token: TokenResponse): readonly string[] {
  const details = token.authorization_details ?? [];
  const out: string[] = [];
  for (const detail of details) {
    const ids = detail['credential_identifiers'];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'string') out.push(id);
      }
    }
  }
  return out;
}

function makeRequestBody(
  proofJwt: string,
  credentialType: string,
  credentialIdentifiers: readonly string[]
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    proofs: { jwt: [proofJwt] },
    format: 'jwt_vc_json',
    credential_definition: { type: ['VerifiableCredential', credentialType] },
    proof: { proof_type: 'jwt', jwt: proofJwt },
  };
  if (credentialIdentifiers.length > 0) {
    body['credential_identifier'] = credentialIdentifiers[0];
  } else {
    body['credential_configuration_id'] = credentialType;
  }
  return body;
}

interface CredentialResultPayload {
  readonly credentialJWT: string;
  readonly format: string;
  readonly credentialType: string;
  readonly issuer: string;
  readonly cNonce?: string;
}

function looksLikeRandomToken(value: string): boolean {
  if (value.length < 16) return false;
  return /^[A-Za-z0-9_-]+$/.test(value);
}

async function postCredentialRequest(
  credentialUrl: string,
  bearer: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch
): Promise<{ readonly response: Response; readonly text: string }> {
  const ac = new AbortController();
  const timeout = setTimeout(() => { ac.abort(); }, DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(credentialUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function executeCredentialRequest(opts: {
  readonly credentialUrl: string;
  readonly accessToken: string;
  readonly proofJwt: string;
  readonly credentialType: string;
  readonly credentialIdentifiers: readonly string[];
  readonly fetchImpl: typeof fetch;
  readonly issuerUrl: string;
  readonly holderDid: string;
  readonly initialCNonce: string | undefined;
}): Promise<Result<CredentialResultPayload, OidcError>> {
  const {
    credentialUrl,
    accessToken,
    proofJwt,
    credentialType,
    credentialIdentifiers,
    fetchImpl,
    issuerUrl,
    holderDid,
    initialCNonce,
  } = opts;
  let body = makeRequestBody(proofJwt, credentialType, credentialIdentifiers);
  let { response, text } = await postCredentialRequest(credentialUrl, accessToken, body, fetchImpl);

  if (!response.ok) {
    let json: RawCredentialResponse | null;
    try {
      json = JSON.parse(text) as RawCredentialResponse;
    } catch {
      json = null;
    }
    if (json?.error === 'invalid_nonce' && typeof json.c_nonce === 'string') {
      if (!credentialUrl.toLowerCase().startsWith('https://')) {
        return err(oidcError('transportNotAllowed', 'invalid_nonce retry requires TLS transport'));
      }
      if (!looksLikeRandomToken(json.c_nonce)) {
        return err(oidcError('credentialRequestFailed', 'invalid_nonce retry rejected: malformed c_nonce'));
      }
      const retryProof = await buildProofJwt(issuerUrl, holderDid, json.c_nonce);
      if (!retryProof.ok) return retryProof;
      body = makeRequestBody(retryProof.value, credentialType, credentialIdentifiers);
      ({ response, text } = await postCredentialRequest(credentialUrl, accessToken, body, fetchImpl));
      if (!response.ok) {
        return err(
          oidcError(
            'credentialRequestFailed',
            `Credential endpoint returned HTTP ${String(response.status)} after invalid_nonce retry`,
            response.status
          )
        );
      }
    } else {
      void initialCNonce;
      return err(
        oidcError(
          'credentialRequestFailed',
          `Credential endpoint returned HTTP ${String(response.status)}${text ? `: ${text.slice(0, 200)}` : ''}`,
          response.status
        )
      );
    }
  }

  let parsed: RawCredentialResponse;
  try {
    parsed = JSON.parse(text) as RawCredentialResponse;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('credentialRequestFailed', `Credential response not JSON: ${m}`));
  }

  const credentialJWT = parsed.credentials?.[0]?.credential ?? parsed.credential;
  if (!credentialJWT) {
    return err(oidcError('credentialRequestFailed', 'Credential endpoint returned no credential'));
  }
  const format = parsed.credentials?.[0]?.format ?? parsed.format ?? 'jwt_vc_json';
  return ok({
    credentialJWT,
    format,
    credentialType,
    issuer: issuerUrl,
    ...(parsed.c_nonce ? { cNonce: parsed.c_nonce } : {}),
  });
}

// MARK: - Storage

interface DecodedVcPayload {
  readonly iss?: string;
  readonly sub?: string;
  readonly nbf?: number;
  readonly iat?: number;
  readonly exp?: number;
  readonly vc?: {
    readonly type?: readonly string[];
    readonly credentialSubject?: { readonly id?: string };
  };
}

function persistCredential(payload: CredentialResultPayload): Result<StoredCredential, OidcError> {
  try {
    const { payload: decoded } = decodeJwtUnsafe<DecodedVcPayload>(payload.credentialJWT);
    const issuerDid = decoded.iss ?? payload.issuer;
    const holderDid =
      decoded.sub ?? decoded.vc?.credentialSubject?.id ?? '';
    const issuedAtSec = decoded.iat ?? decoded.nbf ?? Math.floor(Date.now() / 1000);
    const trustLevel = issuerDid.startsWith('did:web:') ? 'L2' : 'L1';
    const credentialType = decoded.vc?.type?.find((t) => t !== 'VerifiableCredential') ?? payload.credentialType;
    const stored: StoredCredential = {
      id: `${issuerDid}|${issuedAtSec}|${payload.credentialJWT.slice(-16)}`,
      type: credentialType,
      title: credentialType,
      issuerDid,
      holderDid,
      trustLevel,
      rawJwt: payload.credentialJWT,
      issuedAt: new Date(issuedAtSec * 1000),
      ...(decoded.exp ? { expiresAt: new Date(decoded.exp * 1000) } : {}),
      metadataTags: [payload.format],
    };
    void useCredentialStore.getState().add(stored);
    return ok(stored);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return err(oidcError('persistenceError', `Failed to persist credential: ${m}`));
  }
}

// MARK: - Public API

export async function requestCredential(
  opts: RequestCredentialOpts
): Promise<Result<StoredCredential, OidcError>> {
  const { offer, metadata, holderDid, userPin, fetchImpl } = opts;
  const fetchFn = fetchImpl ?? fetch;

  if (!offer.preAuthorizedCode) {
    return err(
      oidcError(
        'invalidOffer',
        'Pre-authorized code missing — authorization_code grant not yet wired'
      )
    );
  }

  const tokenResult = await requestToken({
    tokenEndpoint: metadata.tokenEndpoint,
    grant: {
      type: 'pre-authorized_code',
      preAuthorizedCode: offer.preAuthorizedCode,
      ...(offer.txCode && userPin ? { txCode: userPin } : {}),
    },
    fetchImpl: fetchFn,
  });
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.value;

  let cNonce = token.c_nonce;
  if (metadata.nonceEndpoint) {
    const fresh = await fetchFreshCNonce(metadata.nonceEndpoint, fetchFn);
    if (fresh) cNonce = fresh;
  }

  const credentialType = offer.credentialConfigurationIds[0] ?? 'VerifiableCredential';
  const proofResult = await buildProofJwt(offer.credentialIssuer, holderDid, cNonce);
  if (!proofResult.ok) return proofResult;

  const credentialIdentifiers = extractCredentialIdentifiers(token);
  const credentialResult = await executeCredentialRequest({
    credentialUrl: metadata.credentialEndpoint,
    accessToken: token.access_token,
    proofJwt: proofResult.value,
    credentialType,
    credentialIdentifiers,
    fetchImpl: fetchFn,
    issuerUrl: offer.credentialIssuer,
    holderDid,
    initialCNonce: cNonce,
  });
  if (!credentialResult.ok) return credentialResult;

  return persistCredential(credentialResult.value);
}
