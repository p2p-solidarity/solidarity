/**
 * Biometric gate — wraps expo-local-authentication.
 *
 * Per project CLAUDE.md (Sec rules): Face ID is required for passport save,
 * exchange, sign, present, delete, and export. We funnel all biometric
 * prompts through this module so the prompt text is consistent and so we
 * can centralise opt-out (e.g. dev mode, accessibility) in one place.
 */
import * as LocalAuthentication from 'expo-local-authentication';

export type BiometricReason =
  | 'sign'
  | 'export'
  | 'present'
  | 'delete'
  | 'exchange'
  | 'passportSave';

const PROMPT_BY_REASON: Readonly<Record<BiometricReason, string>> = {
  sign: 'Authorize signing with your identity key',
  export: 'Authorize exporting your private data',
  present: 'Authorize presenting your credentials',
  delete: 'Authorize deleting protected items',
  exchange: 'Authorize a peer credential exchange',
  passportSave: 'Authorize saving your passport credential',
};

/** Check whether the device supports Face ID / Touch ID / Iris and is enrolled. */
export async function isBiometricAvailable(): Promise<boolean> {
  const [hasHw, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHw && isEnrolled;
}

/**
 * Prompt the user. Resolves to `true` on success, `false` on cancel/fail.
 * Callers should treat false as "user denied" and abort the sensitive op.
 */
export async function requireBiometric(reason: BiometricReason): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: PROMPT_BY_REASON[reason],
    fallbackLabel: 'Use device passcode',
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });
  return r.success;
}
