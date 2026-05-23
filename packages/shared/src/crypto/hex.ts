/**
 * Hex codec — used by parity fixtures (Swift emits hex, TS reads hex).
 * Cheap implementation; no allocations in the hot loop.
 */
export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length; i++) {
    out += (b[i] ?? 0).toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error('hex string must have even length');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at ${String(i * 2)}`);
    out[i] = byte;
  }
  return out;
}
