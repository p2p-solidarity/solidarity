/**
 * Base45 (RFC 9285) — the QR-alphanumeric-safe binary encoding used by the
 * `CRD1:` evidence-pack wire (CREDS.md §18: CBOR → COSE_Sign1 → zlib →
 * Base45 → QR alphanumeric EC-Q). The 45-character alphabet is exactly the
 * QR alphanumeric-mode charset, which is what lets a CRD1 QR hold ~2,420
 * characters at EC level Q instead of byte-mode's ~1,660.
 *
 * Every decode path is strict (fail closed): unknown characters, a chunk
 * value ≥ 2^16, an overflowing final byte, or a dangling 1-character tail
 * all throw. Attacker-controlled wires must never round into "close enough"
 * bytes.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const REVERSE: ReadonlyMap<string, number> = new Map(
  ALPHABET.split('').map((char, index) => [char, index])
);

/** Encode bytes to Base45 text (RFC 9285 §4): 2 bytes → 3 chars, 1 → 2. */
export function base45Encode(data: Uint8Array): string {
  const out: string[] = [];
  // `?? 0` never fires — the loop bounds guarantee in-range reads — it only
  // spares the non-null assertions the index signature would otherwise force.
  for (let i = 0; i + 1 < data.length; i += 2) {
    const value = ((data[i] ?? 0) << 8) | (data[i + 1] ?? 0);
    out.push(charAt(value % 45), charAt(Math.floor(value / 45) % 45), charAt(Math.floor(value / (45 * 45))));
  }
  if (data.length % 2 === 1) {
    const value = data[data.length - 1] ?? 0;
    out.push(charAt(value % 45), charAt(Math.floor(value / 45)));
  }
  return out.join('');
}

function charAt(digit: number): string {
  return ALPHABET.charAt(digit);
}

/**
 * Decode Base45 text back to bytes. Throws on any malformed input:
 * characters outside the RFC 9285 alphabet (lowercase included — the
 * alphabet is uppercase-only), a trailing single character, or a chunk
 * that decodes above its range (3-char chunks must be < 2^16, 2-char
 * tails < 2^8).
 */
export function base45Decode(text: string): Uint8Array {
  if (text.length % 3 === 1) {
    throw new Error('base45: dangling character (length ≡ 1 mod 3)');
  }
  const digits = text.split('').map((char) => {
    const digit = REVERSE.get(char);
    if (digit === undefined) throw new Error(`base45: invalid character ${JSON.stringify(char)}`);
    return digit;
  });

  const fullChunks = Math.floor(digits.length / 3);
  const hasTail = digits.length % 3 === 2;
  const out = new Uint8Array(fullChunks * 2 + (hasTail ? 1 : 0));

  for (let i = 0; i < fullChunks; i++) {
    const [c, d, e] = [digits[i * 3], digits[i * 3 + 1], digits[i * 3 + 2]] as [
      number,
      number,
      number,
    ];
    const value = c + d * 45 + e * 45 * 45;
    if (value > 0xffff) throw new Error('base45: chunk value exceeds 16 bits');
    out[i * 2] = value >> 8;
    out[i * 2 + 1] = value & 0xff;
  }
  if (hasTail) {
    const [c, d] = [digits[fullChunks * 3], digits[fullChunks * 3 + 1]] as [number, number];
    const value = c + d * 45;
    if (value > 0xff) throw new Error('base45: tail value exceeds 8 bits');
    out[fullChunks * 2] = value;
  }
  return out;
}
