/**
 * Minimal CBOR (RFC 8949) codec for the `CRD1:` COSE_Sign1 wire. This is not
 * a general-purpose CBOR library — it implements exactly the subset the
 * evidence pack needs, and everything outside that subset fails closed:
 *
 *   encode: null, boolean, integers (safe range, majors 0/1), float64 for
 *           non-integer finite numbers, Uint8Array (bstr), string (tstr),
 *           arrays, plain objects (string keys, canonical order), Map
 *           (number | string keys, canonical order), CborTag.
 *   decode: the same subset, definite lengths only. Indefinite-length items,
 *           half/single-precision floats, simple values other than
 *           false/true/null, 64-bit integers beyond Number.MAX_SAFE_INTEGER,
 *           duplicate map keys, and depth > 32 all throw.
 *
 * Maps decode to `Map` (COSE headers are integer-keyed); `cborToJson`
 * converts a decoded claims tree to plain JSON-shaped data and throws on
 * anything a JSON claims object could not contain (non-string keys, bytes,
 * tags) — attacker-controlled payloads must not smuggle exotic types into
 * code that expects JSON.
 *
 * Canonical map-key order (RFC 8949 §4.2.1, bytewise on the encoded key) is
 * applied on encode so an identical logical payload always yields identical
 * signed bytes.
 */

/** A CBOR tagged value (major type 6) — e.g. COSE_Sign1 is tag 18. */
export class CborTag {
  constructor(
    readonly tag: number,
    readonly value: unknown
  ) {}
}

export type CborValue = unknown;

const MAX_DEPTH = 32;

// ─── Encoding ──────────────────────────────────────────────────────────────

export function cborEncode(value: CborValue): Uint8Array {
  const chunks: number[] = [];
  writeValue(chunks, value, 0);
  return Uint8Array.from(chunks);
}

function writeValue(out: number[], value: CborValue, depth: number): void {
  if (depth > MAX_DEPTH) throw new Error('cbor: nesting too deep');

  if (value === null) {
    out.push(0xf6);
    return;
  }
  if (value === true) {
    out.push(0xf5);
    return;
  }
  if (value === false) {
    out.push(0xf4);
    return;
  }
  if (typeof value === 'number') {
    writeNumber(out, value);
    return;
  }
  if (typeof value === 'string') {
    writeStringLike(out, 3, utf8Encode(value));
    return;
  }
  if (value instanceof Uint8Array) {
    writeStringLike(out, 2, value);
    return;
  }
  if (value instanceof CborTag) {
    writeTypeAndArgument(out, 6, value.tag);
    writeValue(out, value.value, depth + 1);
    return;
  }
  if (Array.isArray(value)) {
    writeTypeAndArgument(out, 4, value.length);
    for (const item of value) writeValue(out, item, depth + 1);
    return;
  }
  if (value instanceof Map) {
    writeMap(
      out,
      [...value.entries()].map(([k, v]) => {
        if (typeof k !== 'number' && typeof k !== 'string') {
          throw new Error('cbor: map keys must be numbers or strings');
        }
        return [k, v] as const;
      }),
      depth
    );
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined
    );
    writeMap(out, entries, depth);
    return;
  }
  throw new Error(`cbor: unsupported value of type ${typeof value}`);
}

function writeMap(
  out: number[],
  entries: readonly (readonly [number | string, unknown])[],
  depth: number
): void {
  // Canonical order: bytewise comparison of the ENCODED keys (RFC 8949 §4.2.1).
  const encoded = entries.map(([key, val]) => {
    const keyBytes: number[] = [];
    writeValue(keyBytes, key, depth + 1);
    return { keyBytes, val };
  });
  encoded.sort((a, b) => compareBytes(a.keyBytes, b.keyBytes));
  writeTypeAndArgument(out, 5, encoded.length);
  for (const { keyBytes, val } of encoded) {
    out.push(...keyBytes);
    writeValue(out, val, depth + 1);
  }
}

function writeNumber(out: number[], value: number): void {
  if (!Number.isFinite(value)) throw new Error('cbor: non-finite numbers are unsupported');
  if (Number.isSafeInteger(value)) {
    if (value >= 0) writeTypeAndArgument(out, 0, value);
    else writeTypeAndArgument(out, 1, -value - 1);
    return;
  }
  // Non-integer finite → float64.
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, value);
  out.push(0xfb);
  for (let i = 0; i < 8; i++) out.push(buf.getUint8(i));
}

function writeStringLike(out: number[], major: 2 | 3, bytes: Uint8Array): void {
  writeTypeAndArgument(out, major, bytes.length);
  for (const b of bytes) out.push(b);
}

function writeTypeAndArgument(out: number[], major: number, argument: number): void {
  if (!Number.isSafeInteger(argument) || argument < 0) {
    throw new Error('cbor: argument out of range');
  }
  const mt = major << 5;
  if (argument < 24) out.push(mt | argument);
  else if (argument < 0x100) out.push(mt | 24, argument);
  else if (argument < 0x10000) out.push(mt | 25, argument >> 8, argument & 0xff);
  else if (argument < 0x100000000) {
    out.push(mt | 26, (argument >>> 24) & 0xff, (argument >>> 16) & 0xff, (argument >>> 8) & 0xff, argument & 0xff);
  } else {
    // 64-bit argument via BigInt — only reachable for very large byte strings
    // or ints; still within Number.isSafeInteger by the guard above.
    const big = BigInt(argument);
    out.push(mt | 27);
    for (let shift = 56n; shift >= 0n; shift -= 8n) {
      out.push(Number((big >> shift) & 0xffn));
    }
  }
}

function compareBytes(a: readonly number[], b: readonly number[]): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

// ─── Decoding ──────────────────────────────────────────────────────────────

interface DecodeState {
  readonly bytes: Uint8Array;
  offset: number;
}

/** Decode a single CBOR item; throws if trailing bytes remain. */
export function cborDecode(bytes: Uint8Array): CborValue {
  const state: DecodeState = { bytes, offset: 0 };
  const value = readValue(state, 0);
  if (state.offset !== bytes.length) throw new Error('cbor: trailing bytes after item');
  return value;
}

function readValue(state: DecodeState, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new Error('cbor: nesting too deep');
  const initial = readByte(state);
  const major = initial >> 5;
  const info = initial & 0x1f;

  switch (major) {
    case 0:
      return readArgument(state, info);
    case 1:
      return -1 - readArgument(state, info);
    case 2:
      return readBytes(state, readArgument(state, info));
    case 3:
      return utf8Decode(readBytes(state, readArgument(state, info)));
    case 4: {
      const length = readArgument(state, info);
      const items: unknown[] = [];
      for (let i = 0; i < length; i++) items.push(readValue(state, depth + 1));
      return items;
    }
    case 5: {
      const length = readArgument(state, info);
      const map = new Map<number | string, unknown>();
      for (let i = 0; i < length; i++) {
        const key = readValue(state, depth + 1);
        if (typeof key !== 'number' && typeof key !== 'string') {
          throw new Error('cbor: map keys must be numbers or strings');
        }
        if (map.has(key)) throw new Error('cbor: duplicate map key');
        map.set(key, readValue(state, depth + 1));
      }
      return map;
    }
    case 6:
      return new CborTag(readArgument(state, info), readValue(state, depth + 1));
    default: {
      // major 7 — simple values and floats.
      if (initial === 0xf4) return false;
      if (initial === 0xf5) return true;
      if (initial === 0xf6) return null;
      if (initial === 0xfb) {
        const view = new DataView(readBytes(state, 8).slice().buffer);
        return view.getFloat64(0);
      }
      throw new Error(`cbor: unsupported item 0x${initial.toString(16)}`);
    }
  }
}

function readArgument(state: DecodeState, info: number): number {
  if (info < 24) return info;
  if (info === 24) return readByte(state);
  if (info === 25) return (readByte(state) << 8) | readByte(state);
  if (info === 26) {
    let value = 0;
    for (let i = 0; i < 4; i++) value = value * 256 + readByte(state);
    return value;
  }
  if (info === 27) {
    let value = 0n;
    for (let i = 0; i < 8; i++) value = (value << 8n) | BigInt(readByte(state));
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('cbor: 64-bit argument exceeds safe integer range');
    }
    return Number(value);
  }
  // 28–30 reserved, 31 = indefinite length.
  throw new Error('cbor: indefinite/reserved lengths are unsupported');
}

function readByte(state: DecodeState): number {
  const byte = state.bytes[state.offset];
  if (byte === undefined) throw new Error('cbor: unexpected end of input');
  state.offset += 1;
  return byte;
}

function readBytes(state: DecodeState, length: number): Uint8Array {
  if (state.offset + length > state.bytes.length) {
    throw new Error('cbor: unexpected end of input');
  }
  const slice = state.bytes.subarray(state.offset, state.offset + length);
  state.offset += length;
  return slice;
}

// ─── JSON bridge ───────────────────────────────────────────────────────────

/**
 * Convert a decoded CBOR tree into plain JSON-shaped data. Maps must be
 * string-keyed; bytes, tags, and non-string map keys throw — the claims
 * payload of a CRD1 pack is a JSON object by construction, so anything else
 * inside it is an attack, not data.
 */
export function cborToJson(value: CborValue): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('cbor→json: non-finite number');
    return value;
  }
  if (Array.isArray(value)) return value.map(cborToJson);
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of value.entries()) {
      if (typeof key !== 'string') throw new Error('cbor→json: non-string map key');
      out[key] = cborToJson(val);
    }
    return out;
  }
  throw new Error('cbor→json: unsupported item in claims payload');
}

// ─── UTF-8 helpers (local: qr/ must not import app-side code) ─────────────

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

function utf8Encode(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}
