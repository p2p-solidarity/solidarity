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
 * attacker-controlled (scanned from an arbitrary QR code, or carried in a
 * deep link with no size limit of its own).
 *
 * `decodeFragment` enforces two hard caps, both well above any legitimate
 * payload (see `FRAGMENT_SIZE_BUDGET_BYTES` above) but far below what an
 * attacker-controlled input could otherwise force:
 *  - `FRAGMENT_MAX_INPUT_BYTES` rejects an oversized fragment string before
 *    any base64url decode or inflate work starts.
 *  - `FRAGMENT_MAX_DECOMPRESSED_BYTES` bounds the inflated output. fflate's
 *    `inflateSync` has no built-in cap, and raw DEFLATE can reach roughly
 *    1000:1 expansion, so decompressing a degenerate ("zip bomb"-style)
 *    input fully before measuring it would let attacker-controlled bytes
 *    force an unbounded allocation. Instead we pass a fixed-size `out`
 *    buffer (`FRAGMENT_MAX_DECOMPRESSED_BYTES + 1`) so fflate can only
 *    truncate into it, never grow past it — a single fixed allocation
 *    regardless of the compression ratio — and treat a fully-filled buffer
 *    as "exceeded the cap".
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

/**
 * Hard cap on `decodeFragment`'s input string length, checked before any
 * decode/inflate work. `frag` is attacker-controlled (QR scan, deep link),
 * and a legitimate fragment never approaches this — `FRAGMENT_SIZE_BUDGET_BYTES`
 * (2048) is already the *soft* QR/URL practical budget, so 16KB leaves
 * generous headroom while still bounding worst-case work on garbage input.
 */
export const FRAGMENT_MAX_INPUT_BYTES = 16_384;

/**
 * Hard cap on `decodeFragment`'s decompressed output size. A real Profile
 * Record JWS is a few KB at most (see vectors/profile.json's
 * `oversize-fragment-budget` vector, ~2.6KB pre-compression); 64KB leaves
 * generous headroom while still bounding a DEFLATE "zip bomb" to one fixed
 * allocation instead of an unbounded one (fflate's `inflateSync` has no
 * built-in cap of its own).
 */
export const FRAGMENT_MAX_DECOMPRESSED_BYTES = 65_536;

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
  if (frag.length > FRAGMENT_MAX_INPUT_BYTES) {
    return err(`fragment: input exceeds ${FRAGMENT_MAX_INPUT_BYTES} byte cap`);
  }

  let compressed: Uint8Array;
  try {
    compressed = base64UrlDecode(frag);
  } catch {
    return err('fragment: not valid base64url');
  }
  if (compressed.length === 0) return err('fragment: decoded to zero bytes');

  let inflated: Uint8Array;
  try {
    // Bounded-memory decompression: a caller-provided fixed-size `out`
    // buffer means fflate can only truncate into it, never reallocate past
    // it, regardless of how compressible (or how much of a "zip bomb") the
    // input is. `+1` lets us tell "output was exactly at the cap" (buffer
    // not full) apart from "output was truncated" (buffer completely full)
    // by checking the returned length.
    const bounded = inflateSync(compressed, {
      out: new Uint8Array(FRAGMENT_MAX_DECOMPRESSED_BYTES + 1),
    });
    if (bounded.length > FRAGMENT_MAX_DECOMPRESSED_BYTES) {
      return err(`fragment: decompressed output exceeds ${FRAGMENT_MAX_DECOMPRESSED_BYTES} byte cap`);
    }
    inflated = bounded;
  } catch (e) {
    return err(`fragment: corrupt deflate stream (${e instanceof Error ? e.message : String(e)})`);
  }

  try {
    return ok(bytesToUtf8(inflated));
  } catch {
    return err('fragment: inflated bytes are not valid UTF-8');
  }
}
