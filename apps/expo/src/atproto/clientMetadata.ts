/**
 * atproto OAuth client identity — 1.3.3 Phase A6 task A6.1.
 *
 * atproto's OAuth profile (https://atproto.com/specs/oauth) requires
 * `client_id` to be a fully-qualified `https://` URL that serves a public
 * "client metadata" JSON document (draft-parecki-oauth-client-id-metadata-
 * document — NOT the older RFC 7591 Dynamic Client Registration). There is
 * no `client_secret`; Authorization Servers fetch this document directly.
 *
 * ── Hosting dependency (READ BEFORE WIRING ANYTHING TO PRODUCTION) ───────
 *
 * `CLIENT_METADATA_DOCUMENT` below is the exact JSON this app requires to
 * be served, byte-for-byte (a `client_id` mismatch or a missing field
 * fails the AS's validation), at:
 *
 *     https://solidarity.gg/oauth/client-metadata.json
 *
 * The web surface (`solidarity.gg`) is a SEPARATE repo (`solidarity-web`,
 * per project decision — NOT `apps/web` in this monorepo), so this app
 * cannot deploy that file itself. This task also writes the identical
 * document to `apps/expo/src/atproto/client-metadata.json` as the
 * hand-off spec for whoever wires up `solidarity-web`'s static hosting.
 * Until that file is live at the URL above with `Content-Type:
 * application/json` and HTTP 200, `startAtprotoOAuth()` will reach the PAR
 * step and fail there — every atproto Authorization Server fetches
 * `client_id` as part of validating the pushed authorization request. This
 * is a deployment dependency, not a bug in this module.
 *
 * ── Field choices ──────────────────────────────────────────────────────
 *
 * - `application_type: 'native'` + `token_endpoint_auth_method: 'none'`:
 *   this is a public client (mobile app, no server-side secret holder).
 *   Confidential-client JWT assertion (`private_key_jwt`) is not used.
 * - `dpop_bound_access_tokens: true` — mandatory per spec for ALL client
 *   types; the App's tokens are always DPoP-sender-constrained.
 * - `redirect_uris`: the custom-scheme entry
 *   (`ATPROTO_REDIRECT_URI`) is what `oauth.ts` actually uses — the OS
 *   scheme `solidarity` is already registered app-wide (`app.json`
 *   `expo.scheme`). Per spec §"Authorization Requests", a native custom
 *   scheme "must be followed by a single colon then a single forward
 *   slash" — i.e. `solidarity:/path`, NOT `solidarity://path` (which is
 *   the shape `expo-auth-session`'s `makeRedirectUri()` produces by
 *   default) — so this is built by hand, not via that helper. The
 *   `https://solidarity.gg/oauth/atproto/callback` universal-link entry is
 *   declared for forward-compatibility (spec explicitly allows native
 *   clients to redirect via an HTTPS URL, e.g. "Apple Universal Links")
 *   but is not the URI `oauth.ts` requests today — Android universal-link
 *   verification depends on the same `solidarity-web`/AASA hosting
 *   dependency called out above, so the custom scheme is the reliable
 *   path for A6.1.
 * - `scope: 'atproto transition:generic'` — `atproto` is mandatory for
 *   every atproto OAuth session. `transition:generic` is the spec's
 *   documented transitional scope ("broad PDS account permissions,
 *   equivalent to the previous App Password level" — includes writing any
 *   repository record type), guaranteed supported by every current PDS/
 *   entryway. It's what A6.2's `com.atproto.repo.putRecord` call (writing
 *   the `app.solidarity.profile` lexicon record) needs. A future task can
 *   tighten this to a resource-scoped permission
 *   (e.g. `repo:app.solidarity.profile`) once that syntax is verified
 *   against the atproto Permissions spec — using the broad transitional
 *   scope now is a real, currently-documented mechanism, not a shortcut
 *   that pretends to be narrower than it is.
 * - `grant_types` includes `refresh_token` — `refreshAtprotoSession()`
 *   requires it to be declared here.
 */

/** The public client-metadata document's own URL — also the OAuth `client_id`. */
export const ATPROTO_CLIENT_ID = 'https://solidarity.gg/oauth/client-metadata.json';

/**
 * Native app-scheme redirect URI actually used by `oauth.ts`. Single slash
 * after the scheme colon — see module doc. `solidarity` is already
 * registered in `apps/expo/app.json`'s `expo.scheme` array.
 */
export const ATPROTO_REDIRECT_URI = 'solidarity:/oauth/atproto/callback';

/** Documented forward-compat universal-link redirect — not used by `oauth.ts` yet (see module doc). */
export const ATPROTO_UNIVERSAL_REDIRECT_URI = 'https://solidarity.gg/oauth/atproto/callback';

/** Space-separated OAuth scope requested by every `startAtprotoOAuth()` call. */
export const ATPROTO_SCOPE = 'atproto transition:generic';

/**
 * The exact JSON that must be served at `ATPROTO_CLIENT_ID` (also mirrored
 * to `apps/expo/src/atproto/client-metadata.json`). Field order/shape
 * follows https://atproto.com/specs/oauth "Client ID Metadata Document".
 */
export const CLIENT_METADATA_DOCUMENT = {
  client_id: ATPROTO_CLIENT_ID,
  client_name: 'Solidarity',
  client_uri: 'https://solidarity.gg',
  redirect_uris: [ATPROTO_REDIRECT_URI, ATPROTO_UNIVERSAL_REDIRECT_URI],
  scope: ATPROTO_SCOPE,
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
  application_type: 'native',
  dpop_bound_access_tokens: true,
} as const;
