/**
 * webSign transport — the entry-point plumbing that turns a scanned QR string
 * or a deep link into the raw request JWS the review flow consumes (research
 * notes-1.3.3 §4). Pure (imports only `@solidarity/shared`), so it is
 * unit-testable and shared by both the deep-link parser (`src/deeplink/
 * parser.ts`) and the in-app scanner (`app/scan/index.tsx`).
 *
 * Wire forms recognised (all EXPLICIT — a bare compact JWS is deliberately
 * NOT treated as a webSign request, so it can never collide with the
 * card-exchange JWTs the envelope handler owns):
 *
 *   solidarity://websign?req=<X>   airmeishi://websign?req=<X>   (query form)
 *   https://<host>/websign#req=<X>                               (fragment form)
 *
 * `<X>` is either the raw request compact JWS, or its compressed
 * `fragment.ts` form for a large draft that would otherwise blow the QR /
 * URL budget — `decodeWebSignRequestParam` disambiguates deterministically.
 * The fragment form's `#req=…` never leaves the device over the network
 * (01-spec §1/§8), which is why the https variant uses the fragment, not the
 * query. Multi-frame QR (a wrapped string too large for one frame) is handled
 * upstream by the shared `qr/chunking.ts` reassembler inside `QrScanner`, so
 * this module only ever sees a single reassembled string.
 */
import { decodeFragment, err, ok, type Result } from '@solidarity/shared';

/** Deep-link host / path segment for the webSign entry (`solidarity://websign`, `/websign`). */
export const WEBSIGN_DEEPLINK_HOST = 'websign';
/** Query/fragment parameter carrying the request payload. */
export const WEBSIGN_REQUEST_PARAM = 'req';
/** Query/fragment parameter carrying the response payload (offline callback). */
export const WEBSIGN_RESPONSE_PARAM = 'res';

/**
 * Decode a `req` param into the raw request compact JWS. A compact JWS is
 * exactly three dot-separated parts; the compressed fragment form is pure
 * base64url (never contains a dot), so the two are disambiguated with zero
 * ambiguity. Never throws — a corrupt fragment fails closed via `Result`.
 */
export function decodeWebSignRequestParam(value: string): Result<string, string> {
  if (value.length === 0) return err('empty webSign request payload');
  if (value.split('.').length === 3) return ok(value);
  return decodeFragment(value);
}

function nonEmptyOrNull(value: string | null): string | null {
  return value !== null && value.length > 0 ? value : null;
}

/**
 * Recognise a scanned/typed string as a wrapped webSign request and return its
 * raw `req` param (still encoded — hand it to `decodeWebSignRequestParam`), or
 * `null` when it is not a webSign entry at all (let the caller fall through to
 * the existing scan-handler chain). Never throws.
 */
export function classifyWebSignScan(payload: string): string | null {
  if (typeof payload !== 'string') return null;
  let url: URL;
  try {
    url = new URL(payload.trim());
  } catch {
    return null;
  }

  if (url.protocol === 'solidarity:' || url.protocol === 'airmeishi:') {
    if (url.host !== WEBSIGN_DEEPLINK_HOST) return null;
    return nonEmptyOrNull(url.searchParams.get(WEBSIGN_REQUEST_PARAM));
  }

  if (url.protocol === 'https:' || url.protocol === 'http:') {
    const segments = url.pathname.replace(/^\//u, '').split('/');
    if (segments.length !== 1 || segments[0] !== WEBSIGN_DEEPLINK_HOST) return null;
    if (url.hash.length <= 1) return null;
    return nonEmptyOrNull(new URLSearchParams(url.hash.slice(1)).get(WEBSIGN_REQUEST_PARAM));
  }

  return null;
}
