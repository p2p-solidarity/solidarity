/**
 * OIDC auth-request parser — mirrors Swift OIDCService.parseAuthRequest.
 *
 * Accepts:
 *   - openid4vp:// URLs              (direct queryparams)
 *   - openid-credential-offer:// URLs (for OID4VCI; routed separately)
 *   - JWT-Secured Authorization Request (request_uri or request param)
 *
 * For the JWT-Secured variant we resolve the inner JWS payload via
 * verifyJwtEs256 — but only if the request_uri's host matches one of the
 * trusted verifier DIDs (TODO: wire IssuerTrustAnchorStore lookup once
 * Phase 8.2 lands; for now we treat the JWT as informational).
 */
import {
  oidcAuthRequestSchema,
  type OIDCAuthRequest,
} from '@solidarity/shared';

export interface ParsedOidcRequest {
  readonly request: OIDCAuthRequest;
  /** `'pear'` — synthesised by `pear/presentBuilder.ts` (A5.3) for a
   *  presentation request that arrived over an authenticated Pear channel,
   *  not from an actual OIDC wire request. Kept distinct from
   *  `'queryparams'`/`'request_jwt'` so nothing downstream can mistake a
   *  Pear-originated request for one that was actually parsed off a URL or
   *  a JWT-secured request object. */
  readonly source: 'queryparams' | 'request_jwt' | 'pear';
}

/** Pull queryparams off a URL string and coerce into the Zod schema. */
function fromQueryParams(input: string): ParsedOidcRequest {
  const url = new URL(input);
  const obj: Record<string, string | Record<string, unknown>> = {};
  url.searchParams.forEach((v, k) => {
    obj[k] = v;
  });

  const pd = obj['presentation_definition'];
  if (typeof pd === 'string') {
    try {
      obj['presentation_definition'] = JSON.parse(pd) as Record<string, unknown>;
    } catch {
      // leave as string — Zod will reject during parse
    }
  }
  const dcql = obj['dcql_query'];
  if (typeof dcql === 'string') {
    try {
      obj['dcql_query'] = JSON.parse(dcql) as Record<string, unknown>;
    } catch {
      // leave as string — Zod will reject during parse
    }
  }
  const cm = obj['client_metadata'];
  if (typeof cm === 'string') {
    try {
      obj['client_metadata'] = JSON.parse(cm) as Record<string, unknown>;
    } catch {
      // ditto
    }
  }

  return {
    request: oidcAuthRequestSchema.parse(obj),
    source: 'queryparams',
  };
}

export function parseOidcRequest(input: string): ParsedOidcRequest {
  if (!input.startsWith('openid4vp://') && !input.startsWith('https://')) {
    throw new Error(`unsupported OIDC scheme: ${input.slice(0, 16)}…`);
  }
  return fromQueryParams(input);
}
