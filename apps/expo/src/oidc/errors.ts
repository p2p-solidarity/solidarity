/**
 * OidcError — discriminated union mirroring the variants the Swift services
 * raise via `CardError`/`OIDCTokenError`. We carry our own type instead of
 * leaning on `CardError` directly so the OIDC surface can stay free of
 * unrelated card-domain noise (passGenerationError, ocrError, …).
 */

export type OidcErrorCode =
  | 'invalidRequest'
  | 'invalidOffer'
  | 'metadataFetchFailed'
  | 'tokenRequestFailed'
  | 'credentialRequestFailed'
  | 'pkceFailed'
  | 'replayDetected'
  | 'untrustedIssuer'
  | 'keyManagement'
  | 'cryptographicError'
  | 'networkError'
  | 'transportNotAllowed'
  | 'submissionFailed'
  | 'persistenceError';

export interface OidcError {
  readonly code: OidcErrorCode;
  readonly message: string;
  readonly httpStatus?: number;
}

export function oidcError(code: OidcErrorCode, message: string, httpStatus?: number): OidcError {
  return httpStatus === undefined ? { code, message } : { code, message, httpStatus };
}
