/**
 * fieldEncoding — pure TS port of Swift's
 * `SemaphoreIdentityManager.decimalStringToLittleEndian32` /
 * `clampToMax32Bytes` / `canonicalCommitments`.
 *
 * These helpers exist BOTH here AND in the native module
 * (`SemaphoreShim.swift` for iOS, `HybridSemaphore.kt` for Android).
 * They MUST stay bit-identical because:
 *   1. The native side feeds the result into the Rust binding's
 *      `Field::from_le_bytes_mod_order` — any byte-level drift = wrong
 *      Merkle root.
 *   2. The JS side uses the same encoding when computing local UI
 *      fingerprints + when validating user-supplied commitments before
 *      crossing the bridge (so we fail fast on garbage input rather than
 *      surfacing a confusing native-side error).
 *
 * KEEP IN SYNC checklist (any change here needs equal changes in):
 *   - solidarity/Services/ZK/SemaphoreIdentityManager.swift:402-453
 *   - nitro-modules/semaphore/ios/SemaphoreShim.swift
 *   - nitro-modules/semaphore/android/src/main/java/gg/solidarity/semaphore/
 *     HybridSemaphore.kt (decimalStringToLittleEndian32 + clampToMax32Bytes)
 */

/**
 * Trim → dedupe → sort. Identical to Swift
 * `SemaphoreIdentityManager.canonicalCommitments(_:)`.
 */
export function canonicalCommitments(
  commitments: readonly string[]
): readonly string[] {
  const out = new Set<string>();
  for (const c of commitments) {
    const trimmed = c.trim();
    if (trimmed.length > 0) out.add(trimmed);
  }
  return [...out].sort();
}

/**
 * UTF-8 byte-truncate to ≤32 bytes. Identical to Swift `clampToMax32Bytes`.
 *
 * If the cut point lands inside a multi-byte UTF-8 sequence, walk back to
 * the previous full code-point boundary so the resulting string is still
 * valid UTF-8 (same behaviour as Swift's `String(data:encoding:)` with
 * the truncated bytes — it returns "" on invalid UTF-8, so we explicitly
 * walk back rather than emit a replacement character).
 */
export function clampToMax32Bytes(input: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(input);
  if (bytes.length <= 32) return input;

  const decoder = new TextDecoder('utf-8', { fatal: true });
  for (let cut = 32; cut >= 0; cut--) {
    try {
      return decoder.decode(bytes.slice(0, cut));
    } catch {
      // not a valid UTF-8 boundary; try cut - 1
    }
  }
  return '';
}

/**
 * Decimal-string field element → 32-byte little-endian Uint8Array.
 * Identical to Swift `decimalStringToLittleEndian32`.
 *
 * Schoolbook multiplication: result = result * 10 + digit, with byte-level
 * carry propagation. Throws when the value exceeds 256 bits OR when a
 * non-decimal scalar is encountered.
 */
export function decimalStringToLittleEndian32(value: string): Uint8Array {
  const normalised = value.trim();
  if (normalised.length === 0) {
    throw new Error('Commitment is empty.');
  }
  if (!/^\d+$/.test(normalised)) {
    throw new Error('Commitment must be a decimal field element string.');
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < normalised.length; i++) {
    const digit = normalised.charCodeAt(i) - 0x30; // '0' = 0x30
    let carry = digit;
    for (let j = 0; j < bytes.length; j++) {
      // `bytes[j]` cannot be undefined — j is bounded by bytes.length, but
      // TS's noUncheckedIndexedAccess can't prove that. Coerce explicitly.
      const current: number = bytes[j] ?? 0;
      const total = current * 10 + carry;
      bytes[j] = total & 0xff;
      carry = total >>> 8;
    }
    if (carry > 0) {
      throw new Error('Commitment exceeds 256-bit field element size.');
    }
  }
  return bytes;
}

/**
 * Inverse: 32-byte little-endian → decimal string. Mirrors the helper in
 * SemaphoreShim.swift / HybridSemaphore.kt so root-hash decoding matches
 * across all three platforms.
 */
export function littleEndian32ToDecimalString(bytes: Uint8Array): string {
  if (bytes.length > 32) {
    throw new Error('input must be ≤ 32 bytes');
  }
  const digits: number[] = [0];
  for (let i = bytes.length - 1; i >= 0; i--) {
    let carry: number = bytes[i] ?? 0;
    for (let j = 0; j < digits.length; j++) {
      const total = (digits[j] ?? 0) * 256 + carry;
      digits[j] = total % 10;
      carry = (total / 10) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 10);
      carry = (carry / 10) | 0;
    }
  }
  while (digits.length > 1 && digits[digits.length - 1] === 0) digits.pop();
  return digits.reverse().join('');
}
