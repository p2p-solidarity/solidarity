/**
 * Native biometric binding policy for NEW signing keys.
 *
 * Phase 4 (2026-06-13): always `false` — the JS gate
 * (`requireBiometric('sign')` + the shared grace bucket) is the canonical
 * prompt. Binding the key natively double-gates every signature:
 *   - iOS: a `.userPresence` Secure Enclave ACL makes `SecKeyCreateSignature`
 *     pop its own Face ID sheet on top of the JS prompt.
 *   - Android: a per-use auth-bound key (`setUserAuthenticationParameters(0,
 *     AUTH_BIOMETRIC_STRONG)`) cannot sign at all without a CryptoObject
 *     BiometricPrompt — `Signature.initSign` throws
 *     `UserNotAuthenticatedException` regardless of any app-level prompt.
 *
 * Keys that ALREADY carry a native ACL (pre-phase-4 installs) are handled at
 * sign time via `keyAuthMode` — the JS layer steps aside and lets the native
 * prompt be the single gate.
 */
export function shouldRequireNativeBiometricBinding(
  _biometricAvailable: boolean
): boolean {
  return false;
}
