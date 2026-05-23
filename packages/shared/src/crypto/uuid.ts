/**
 * Cross-runtime v4 UUID generator.
 *
 * Why this exists: `react-native-get-random-values` polyfills
 * `crypto.getRandomValues` on React Native but NOT `crypto.randomUUID`,
 * which throws "undefined is not a function" the moment any onboarding /
 * card / contact code runs on a device. Swift's `UUID().uuidString` always
 * yields a v4 string, so we match that here.
 *
 * Resolution order:
 *   1. `globalThis.crypto.randomUUID()` — Web / Node 19+ / Bun
 *   2. Build a v4 from `crypto.getRandomValues` — React Native + Hermes
 *
 * Returns the canonical lowercase 8-4-4-4-12 form.
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('uuid(): no crypto.getRandomValues — ensure react-native-get-random-values is imported at app entry');
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  // RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    hex.push((bytes[i] ?? 0).toString(16).padStart(2, '0'));
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  );
}
