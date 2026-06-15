/**
 * Sakura relay TLS pin set — single source of truth.
 *
 * Mirrors Swift `solidarity/Services/Sharing/MessageServerPinning.swift`
 * 1:1. The Swift file currently returns an empty pin set with a
 * `TODO(security)` note:
 *
 *   > To enable production traffic: replace the empty array below with
 *   > the base64-encoded sha256 of the leaf certificate's
 *   > SubjectPublicKeyInfo. Optionally include a backup pin to support
 *   > certificate rotation.
 *
 * We intentionally ship an empty array here too — fabricating fake hashes
 * would defeat the pin (the wrapper falls back to raw fetch in DEV when
 * empty, and rejects in release builds). When Swift gets real hashes,
 * paste the SAME `base64(sha256(SPKI))` values into `SAKURA_PINNED_HASHES`
 * below — the wire format matches `react-native-ssl-pinning`'s public
 * key pinning mode (prefixed with `sha256/`).
 *
 * Trust policy (matches PinnedSessionDelegate in MessageService.swift):
 *   - Non-empty pin set + leaf SPKI matches  → accept.
 *   - Non-empty pin set + no match           → REJECT (fail closed).
 *   - Empty pin set + release build          → REJECT (fail closed).
 *   - Empty pin set + DEV build              → accept after system trust
 *                                              (development convenience).
 *
 * Override at staging via the `EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES`
 * env var (comma-separated base64 SHA-256 SPKI hashes, no `sha256/`
 * prefix — `pinnedFetch.ts` adds the prefix when handing off to the
 * native module).
 */

/** Pinned host — mirrors Swift `MessageService.pinnedHost`. */
export const SAKURA_PINNED_HOST = 'bussiness-card.kidneyweakx.com';

/**
 * SHA-256 of the Sakura relay server's leaf cert SubjectPublicKeyInfo
 * (base64-encoded, no `sha256/` prefix).
 *
 * EMPTY by design — matches Swift `MessageServerPinning.pinnedSPKIHashes`
 * verbatim. Replace with the real `base64(sha256(SPKI))` value(s) once
 * the Swift file gets them; include a backup pin for rotation.
 */
export const SAKURA_PINNED_HASHES: readonly string[] = [] as const;

/**
 * True when the wrapper may fall back to system trust evaluation while no
 * real pin is configured. Production builds must NOT reach the network
 * when the pin set is empty.
 *
 * Mirrors Swift `MessageServerPinning.allowsUnpinnedFallback` (#if DEBUG).
 */
export function allowsUnpinnedFallback(): boolean {
  return typeof __DEV__ !== 'undefined'
    ? __DEV__
    : process.env.NODE_ENV !== 'production';
}

/**
 * Resolve the effective pin set, applying the staging override env var if
 * present. Returns the raw base64 hashes (no `sha256/` prefix); the
 * caller prefixes them when handing off to the pinning library.
 */
export function resolvePinnedHashes(): readonly string[] {
  const override = process.env['EXPO_PUBLIC_SAKURA_PIN_OVERRIDE_HASHES'];
  if (override && override.trim().length > 0) {
    return override
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return SAKURA_PINNED_HASHES;
}
