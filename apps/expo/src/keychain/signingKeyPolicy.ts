/**
 * AndroidKeyStore rejects per-use biometric keys unless at least one
 * biometric is enrolled. Keep the native key auth-bound only when the OS can
 * actually create that key; app-level signing still prompts via biometric.ts.
 */
export function shouldRequireNativeBiometricBinding(
  biometricAvailable: boolean
): boolean {
  return biometricAvailable;
}
