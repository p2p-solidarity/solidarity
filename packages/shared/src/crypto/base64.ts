/**
 * Base64 + base64url codec — mirrors solidarity/Extensions/Data+Base64URL.swift.
 *
 * RFC 4648 url-safe: `-` for `+`, `_` for `/`, no padding.
 *
 * We don't use Node's `Buffer` (RN doesn't have it without polyfills) and
 * we don't use the browser `atob/btoa` (they choke on binary), so we
 * implement directly over Uint8Array. Mirrors @noble's bytesToBase64 helpers
 * but uses the wire format Swift produces.
 */
const STANDARD =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URLSAFE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    // Alphabet indices come from 6-bit masks of a 24-bit value, so they're
    // guaranteed to be in [0, 63] — the `?? ''` keeps strict TS happy
    // (alphabet[number] is `string | undefined` under noUncheckedIndexedAccess).
    out += alphabet[(triple >> 18) & 0x3f] ?? '';
    out += alphabet[(triple >> 12) & 0x3f] ?? '';
    out += i + 1 < bytes.length ? (alphabet[(triple >> 6) & 0x3f] ?? '') : '=';
    out += i + 2 < bytes.length ? (alphabet[triple & 0x3f] ?? '') : '=';
  }
  return pad ? out : out.replace(/=+$/u, '');
}

function decode(input: string, alphabet: string): Uint8Array {
  const cleaned = input.replace(/=+$/u, '');
  const len = cleaned.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let pos = 0;
  for (let i = 0; i < len; i += 4) {
    const a = alphabet.indexOf(cleaned[i] ?? '');
    const b = alphabet.indexOf(cleaned[i + 1] ?? '');
    const c = alphabet.indexOf(cleaned[i + 2] ?? '');
    const d = alphabet.indexOf(cleaned[i + 3] ?? '');
    if (a < 0 || b < 0) throw new Error('invalid base64');
    out[pos++] = ((a << 2) | (b >> 4)) & 0xff;
    if (c >= 0 && i + 2 < len) out[pos++] = ((b << 4) | (c >> 2)) & 0xff;
    if (d >= 0 && i + 3 < len) out[pos++] = ((c << 6) | d) & 0xff;
  }
  return out.subarray(0, pos);
}

export const base64Encode = (b: Uint8Array): string => encode(b, STANDARD, true);
export const base64Decode = (s: string): Uint8Array => decode(s, STANDARD);
export const base64UrlEncode = (b: Uint8Array): string =>
  encode(b, URLSAFE, false);
export const base64UrlDecode = (s: string): Uint8Array => decode(s, URLSAFE);

/** Convert a UTF-8 string to bytes (TextEncoder is universally available in RN). */
export const utf8ToBytes = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Convert bytes back to a UTF-8 string. Throws on invalid sequences. */
export const bytesToUtf8 = (b: Uint8Array): string =>
  new TextDecoder('utf-8', { fatal: true }).decode(b);
