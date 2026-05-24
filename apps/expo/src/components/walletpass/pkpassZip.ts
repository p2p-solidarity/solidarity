/**
 * pkpassZip — pure-TS port of solidarity/Services/Sharing/ZIPWriter.swift.
 *
 * Builds a minimal STORED (no compression) ZIP archive byte-equivalent to
 * the Swift output: identical local-file-header layout, identical central
 * directory record, identical end-of-central-directory record, identical
 * CRC-32 algorithm (0xEDB88320 polynomial). Files preserve insertion order.
 *
 * Why hand-rolled (rather than `jszip` / `fflate`)?
 *   - Apple's .pkpass format requires only STORED entries; compression is
 *     irrelevant for the small (~10 KB) bundles produced here.
 *   - Adds zero runtime deps to the bundle (the Swift original is also
 *     ~200 lines of hand-rolled ZIP).
 *   - Bit-for-bit reproducibility means PassKit acceptance parity with
 *     the iOS app is provable rather than implementation-dependent.
 *
 * Limits: file size capped at 2^32-1 bytes per entry (ZIP-32 spec). Wallet
 * passes never approach this. All filenames must be ASCII (pkpass spec
 * requires `pass.json`, `manifest.json`, `signature`, `logo*.png`, etc.).
 */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Standard CRC-32 (poly 0xEDB88320) — matches Swift ZIPWriter.calculateCRC32. */
const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i >>> 0;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
    }
    t[i] = crc >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of data) {
    const idx = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ (CRC32_TABLE[idx] ?? 0);
  }
  return (~crc >>> 0) & 0xff_ff_ff_ff;
}

const TEXT_ENC = new TextEncoder();

function asciiBytes(name: string): Uint8Array {
  // pkpass filenames are ASCII (pass.json, manifest.json, signature, *.png).
  // TextEncoder yields UTF-8 which is byte-compatible for ASCII codepoints
  // and matches Swift's `Data(name.utf8)`.
  return TEXT_ENC.encode(name);
}

function u16le(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xff_ff, true);
}

function u32le(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/**
 * Build a ZIP archive byte stream from `entries`. STORED method, no
 * compression, no descriptors. Modification timestamp is fixed at
 * 00:00:00 on 1980-01-01 (DOS epoch) — same as the Swift writer.
 */
export function buildPkpassZip(entries: readonly ZipEntry[]): Uint8Array {
  // Pre-compute per-entry metadata so we know the central-directory offset.
  interface Computed extends ZipEntry {
    readonly nameBytes: Uint8Array;
    readonly crc: number;
    readonly localOffset: number;
  }
  const computed: Computed[] = [];

  const localChunks: Uint8Array[] = [];
  let cursor = 0;

  for (const entry of entries) {
    const nameBytes = asciiBytes(entry.name);
    const crc = crc32(entry.data);
    const localOffset = cursor;

    // Local file header: 30 bytes + filename + data
    const header = new Uint8Array(30);
    const hv = new DataView(header.buffer);
    u32le(hv, 0, 0x04_03_4b_50); // PK\x03\x04 LE
    u16le(hv, 4, 0x00_14); // version needed: 2.0
    u16le(hv, 6, 0x00_00); // general purpose flag
    u16le(hv, 8, 0x00_00); // compression: stored
    u16le(hv, 10, 0x00_00); // last mod time
    u16le(hv, 12, 0x21_00); // last mod date (1980-01-01) — Swift uses [0x00, 0x21] = 0x2100
    u32le(hv, 14, crc);
    u32le(hv, 18, entry.data.length); // compressed size = uncompressed
    u32le(hv, 22, entry.data.length); // uncompressed size
    u16le(hv, 26, nameBytes.length);
    u16le(hv, 28, 0); // extra field length

    localChunks.push(header, nameBytes, entry.data);
    cursor += header.length + nameBytes.length + entry.data.length;

    computed.push({ ...entry, nameBytes, crc, localOffset });
  }

  // Central directory
  const centralChunks: Uint8Array[] = [];
  let centralSize = 0;
  for (const e of computed) {
    const header = new Uint8Array(46);
    const hv = new DataView(header.buffer);
    u32le(hv, 0, 0x02_01_4b_50); // PK\x01\x02 LE
    u16le(hv, 4, 0x00_14); // version made by
    u16le(hv, 6, 0x00_14); // version needed
    u16le(hv, 8, 0x00_00); // general purpose flag
    u16le(hv, 10, 0x00_00); // compression: stored
    u16le(hv, 12, 0x00_00); // last mod time
    u16le(hv, 14, 0x21_00); // last mod date
    u32le(hv, 16, e.crc);
    u32le(hv, 20, e.data.length); // compressed
    u32le(hv, 24, e.data.length); // uncompressed
    u16le(hv, 28, e.nameBytes.length);
    u16le(hv, 30, 0); // extra field length
    u16le(hv, 32, 0); // file comment length
    u16le(hv, 34, 0); // disk number start
    u16le(hv, 36, 0); // internal file attrs
    u32le(hv, 38, 0); // external file attrs
    u32le(hv, 42, e.localOffset);

    centralChunks.push(header, e.nameBytes);
    centralSize += header.length + e.nameBytes.length;
  }

  const centralOffset = cursor;

  // End of central directory record
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  u32le(ev, 0, 0x06_05_4b_50); // PK\x05\x06 LE
  u16le(ev, 4, 0); // disk number
  u16le(ev, 6, 0); // disk with central dir
  u16le(ev, 8, entries.length); // entries on this disk
  u16le(ev, 10, entries.length); // total entries
  u32le(ev, 12, centralSize);
  u32le(ev, 16, centralOffset);
  u16le(ev, 20, 0); // ZIP comment length

  return concat([...localChunks, ...centralChunks, eocd]);
}
