/**
 * URL-fragment codec — the offline/QR publication surface for a signed
 * Profile Record (01-spec §4.3): `deflate(profileJws) -> base64url`,
 * embedded after `#` in `https://solidarity.gg/#<fragment>`. A URL
 * fragment is never sent over the network (no server, no CDN log ever
 * sees it — 01-spec §1/§8), so this module only ever runs client-side.
 *
 * fflate's plain `deflateSync`/`inflateSync` (no gzip/zlib wrapper) are
 * *raw* DEFLATE — the smallest wire form, appropriate for a size-budgeted
 * QR payload where every wrapper byte counts.
 *
 * `encodeFragment` never throws and never blocks on size: the ~2048-byte
 * budget is a QR-density/UX concern (a bigger payload just makes for a
 * denser, harder-to-scan code), not a correctness one, so oversize input
 * still gets a valid `fragment` back with `oversize: true` for the caller
 * to warn on (06-plan W2.3: ">2KB 顯示尺寸警告"). `decodeFragment` never
 * throws — malformed base64url, a corrupt/non-DEFLATE byte stream, or an
 * empty string all fail closed via `Result`, since `frag` is
 * attacker-controlled (scanned from an arbitrary QR code).
 */
import { deflateSync, inflateSync } from 'fflate';

import { base64UrlDecode, base64UrlEncode, bytesToUtf8, utf8ToBytes } from './crypto/base64';
import { err, ok, type Result } from './types/result';

/**
 * Soft QR size budget in bytes, measured on the final base64url fragment
 * string (what actually gets embedded in the URL / encoded into the QR
 * code) — not the pre-base64 compressed buffer. base64url is pure ASCII,
 * so `fragment.length` is exactly the byte count a QR byte-mode encoder
 * would see.
 */
export const FRAGMENT_SIZE_BUDGET_BYTES = 2048;

export interface FragmentResult {
  /** base64url(deflateRaw(profileJws)) — safe to embed after `#` in a URL. */
  readonly fragment: string;
  /** `fragment.length` in bytes (ASCII, so also its char length). */
  readonly bytes: number;
  /** `bytes > FRAGMENT_SIZE_BUDGET_BYTES` — informational only, never blocks. */
  readonly oversize: boolean;
}

/** Compress `profileJws` (raw DEFLATE) and base64url-encode it for a URL fragment / QR payload. */
export function encodeFragment(profileJws: string): FragmentResult {
  const compressed = deflateSync(utf8ToBytes(profileJws));
  const fragment = base64UrlEncode(compressed);
  return {
    fragment,
    bytes: fragment.length,
    oversize: fragment.length > FRAGMENT_SIZE_BUDGET_BYTES,
  };
}

/**
 * Reverse `encodeFragment`: base64url-decode then inflate back to the
 * original string. Never throws — base64url decode failure, a corrupt
 * DEFLATE stream, non-UTF-8 inflated bytes, and an empty `frag` all
 * return `err(reason)`.
 */
export function decodeFragment(frag: string): Result<string, string> {
  if (frag.length === 0) return err('fragment: empty input');

  let compressed: Uint8Array;
  try {
    compressed = base64UrlDecode(frag);
  } catch {
    return err('fragment: not valid base64url');
  }
  if (compressed.length === 0) return err('fragment: decoded to zero bytes');

  let inflated: Uint8Array;
  try {
    inflated = inflateSync(compressed);
  } catch (e) {
    return err(`fragment: corrupt deflate stream (${e instanceof Error ? e.message : String(e)})`);
  }

  try {
    return ok(bytesToUtf8(inflated));
  } catch {
    return err('fragment: inflated bytes are not valid UTF-8');
  }
}
