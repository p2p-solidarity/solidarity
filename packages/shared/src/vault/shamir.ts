/**
 * Shamir Secret Sharing over GF(256) — mirrors Swift
 * solidarity/Services/Vault/ShamirSecretSharing.swift.
 *
 * Splits a secret (Uint8Array) into N shares such that any T are sufficient
 * to reconstruct the original. Polynomial coefficients are random; the
 * field is GF(2^8) using the AES Rijndael irreducible polynomial 0x11b.
 *
 * Each share's byte layout (1 + N*1 bytes per byte of secret):
 *   share = [ index : 1 ] || [ y₀, y₁, …, y_{L-1} : L ]
 *
 * where y_i = f_i(index) — the i-th byte of the secret evaluated through
 * its own polynomial. Reconstruction runs Lagrange interpolation per byte.
 */
import { randomBytes } from '@noble/hashes/utils';

const FIELD_SIZE = 256;

// GF(256) exp/log tables generated from primitive element 0x03 with
// reduction polynomial 0x11b (Rijndael). Single static initialisation.
const EXP = new Uint8Array(FIELD_SIZE * 2);
const LOG = new Uint8Array(FIELD_SIZE);
let initialised = false;

function initTables(): void {
  if (initialised) return;
  let x = 1;
  for (let i = 0; i < FIELD_SIZE - 1; i++) {
    EXP[i] = x & 0xff;
    LOG[x] = i;
    x ^= (x << 1) & 0xff ^ ((x & 0x80) !== 0 ? 0x1b : 0);
  }
  // Mirror exp to avoid mod in mul().
  for (let i = FIELD_SIZE - 1; i < EXP.length; i++) {
    EXP[i] = EXP[i - (FIELD_SIZE - 1)] ?? 0;
  }
  initialised = true;
}

function mul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] ?? 0) + (LOG[b] ?? 0)] ?? 0;
}

function div(a: number, b: number): number {
  if (a === 0) return 0;
  if (b === 0) throw new Error('division by zero in GF(256)');
  const idx = (LOG[a] ?? 0) - (LOG[b] ?? 0) + (FIELD_SIZE - 1);
  return EXP[idx] ?? 0;
}

/** Evaluate poly `coeffs` (low-degree first) at x via Horner's rule. */
function evalPoly(coeffs: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = mul(acc, x) ^ (coeffs[i] ?? 0);
  }
  return acc;
}

export interface ShamirShare {
  /** 1-based share index (the polynomial argument). */
  readonly index: number;
  /** Per-byte y values; length === secret.length. */
  readonly y: Uint8Array;
}

/**
 * Split `secret` into `total` shares; any `threshold` of them recovers it.
 * Threshold must be 2 ≤ T ≤ N ≤ 255 (1 share is just the secret).
 */
export function split(
  secret: Uint8Array,
  threshold: number,
  total: number
): readonly ShamirShare[] {
  initTables();
  if (threshold < 2 || total < threshold || total > 255) {
    throw new Error(`invalid (threshold=${String(threshold)}, total=${String(total)})`);
  }

  const shares: ShamirShare[] = [];
  for (let i = 1; i <= total; i++) {
    shares.push({ index: i, y: new Uint8Array(secret.length) });
  }

  for (let b = 0; b < secret.length; b++) {
    const coeffs = [secret[b] ?? 0];
    const rand = randomBytes(threshold - 1);
    for (let k = 0; k < threshold - 1; k++) coeffs.push(rand[k] ?? 0);
    for (let i = 0; i < total; i++) {
      (shares[i] as { y: Uint8Array }).y[b] = evalPoly(coeffs, i + 1);
    }
  }
  return shares;
}

/**
 * Reconstruct the secret from at least `threshold` shares. Extra shares
 * are accepted; they raise confidence but don't change the result.
 */
export function combine(shares: readonly ShamirShare[]): Uint8Array {
  initTables();
  if (shares.length === 0) throw new Error('need at least one share');
  const length = shares[0]?.y.length ?? 0;
  if (shares.some((s) => s.y.length !== length)) {
    throw new Error('shares have inconsistent byte lengths');
  }

  const out = new Uint8Array(length);
  for (let b = 0; b < length; b++) {
    let acc = 0;
    for (let i = 0; i < shares.length; i++) {
      const xi = shares[i]?.index ?? 0;
      const yi = shares[i]?.y[b] ?? 0;
      let num = 1;
      let den = 1;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        const xj = shares[j]?.index ?? 0;
        num = mul(num, xj);
        den = mul(den, xi ^ xj);
      }
      acc ^= mul(yi, div(num, den));
    }
    out[b] = acc;
  }
  return out;
}
