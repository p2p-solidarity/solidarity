/**
 * OIDC response submission — TS port of
 * solidarity/Services/Identity/OIDCService+Submit.swift +
 * `+Response.swift`, scoped to the vp_token path.
 *
 * Behaviour parity with Swift:
 *   - `response_uri` present + response_mode starts with `direct_post`
 *     → POST form-encoded `vp_token`, `presentation_submission`, `state`.
 *   - `redirect_uri` present (no response_uri) → caller-facing redirect
 *     URL with the same fields appended (no fetch — the screen opens it
 *     via Linking on success).
 *   - HTTPS-only outbound POST (Swift refuses cleartext); response body is
 *     capped so a hostile verifier cannot stream garbage back.
 *   - `presentation_submission` field is JSON-encoded into the form value
 *     so the verifier reads `JSON.parse(form["presentation_submission"])`
 *     — matching the canonical OID4VP wire shape and the Swift output.
 */
import { err, ok, type Result } from '@solidarity/shared';

import { oidcError, type OidcError } from './errors';
import type { ParsedOidcRequest } from './parseAuthRequest';
import type { PresentationSubmission } from './presenter';

const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface SubmitAuthorizationResponseOpts {
  readonly request: ParsedOidcRequest;
  readonly vpJwt: string;
  readonly presentationSubmission: PresentationSubmission;
  readonly fetchImpl?: typeof fetch;
}

export interface SubmitAuthorizationResponseResult {
  readonly redirectTo?: string;
  readonly httpStatus: number;
}

function isDirectPost(responseMode: string): boolean {
  return responseMode.toLowerCase().startsWith('direct_post');
}

function buildFormBody(opts: SubmitAuthorizationResponseOpts): URLSearchParams {
  const body = new URLSearchParams();
  body.set('vp_token', opts.vpJwt);
  body.set('presentation_submission', JSON.stringify(opts.presentationSubmission));
  if (opts.request.request.state) {
    body.set('state', opts.request.request.state);
  }
  return body;
}

function buildRedirectUrl(target: string, opts: SubmitAuthorizationResponseOpts): string | null {
  try {
    const url = new URL(target);
    url.searchParams.set('vp_token', opts.vpJwt);
    url.searchParams.set(
      'presentation_submission',
      JSON.stringify(opts.presentationSubmission)
    );
    if (opts.request.request.state) {
      url.searchParams.set('state', opts.request.request.state);
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function submitAuthorizationResponse(
  opts: SubmitAuthorizationResponseOpts
): Promise<Result<SubmitAuthorizationResponseResult, OidcError>> {
  const req = opts.request.request;
  const responseMode = req.response_mode;
  const responseUri = req.response_uri;
  const redirectUri = req.redirect_uri;

  if (isDirectPost(responseMode) || responseUri) {
    const target = responseUri ?? redirectUri;
    if (!target) {
      return err(oidcError('invalidRequest', 'No response_uri / redirect_uri to submit to'));
    }
    if (!target.toLowerCase().startsWith('https://')) {
      return err(oidcError('transportNotAllowed', 'vp_token submission requires https'));
    }
    const ac = new AbortController();
    const timeout = setTimeout(() => { ac.abort(); }, DEFAULT_TIMEOUT_MS);
    try {
      const fetchImpl = opts.fetchImpl ?? fetch;
      const response = await fetchImpl(target, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: buildFormBody(opts).toString(),
        signal: ac.signal,
      });
      const text = await response.text().catch(() => '');
      if (text.length > MAX_RESPONSE_BYTES) {
        return err(oidcError('submissionFailed', 'Verifier response exceeds size limit', response.status));
      }
      if (!response.ok) {
        return err(
          oidcError(
            'submissionFailed',
            `Verifier returned HTTP ${String(response.status)}${text ? `: ${text.slice(0, 200)}` : ''}`,
            response.status
          )
        );
      }
      let redirectTo: string | undefined;
      try {
        const parsed = JSON.parse(text) as { readonly redirect_uri?: unknown };
        if (typeof parsed.redirect_uri === 'string') {
          redirectTo = parsed.redirect_uri;
        }
      } catch {
        // empty/ack body — no follow-up redirect
      }
      return ok({
        httpStatus: response.status,
        ...(redirectTo ? { redirectTo } : {}),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(oidcError('submissionFailed', `Failed to submit vp_token: ${message}`));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!redirectUri) {
    return err(oidcError('invalidRequest', 'No redirect_uri to follow up with'));
  }
  const built = buildRedirectUrl(redirectUri, opts);
  if (!built) {
    return err(oidcError('invalidRequest', 'Failed to build redirect URL'));
  }
  return ok({ httpStatus: 200, redirectTo: built });
}

