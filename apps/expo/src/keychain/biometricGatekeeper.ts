/**
 * Biometric gatekeeper — 1:1 port of `BiometricGatekeeper.swift`.
 *
 * Wraps the low-level `biometric.ts` `requireBiometric` helper with the
 * per-action policy lookup from `sensitiveActionPolicy.ts`, returning a
 * typed `BiometricResult` so callers can branch on the specific failure
 * mode without parsing strings.
 *
 * Swift contract recap (`BiometricGatekeeper.authorizeIfRequired`):
 *   - if `requiresBiometric(action) == false` → succeed immediately.
 *   - else prompt LAContext, prefer `.deviceOwnerAuthenticationWithBiometrics`
 *     when biometrics are enrolled, fall back to `.deviceOwnerAuthentication`
 *     so the user can use the device passcode.
 *   - returns `CardResult<Void>` → success / `keyManagementError(reason)`.
 *
 * TS contract:
 *   - `requireSensitiveAction(action, reason)` is the public surface every
 *     sensitive call site uses. Reason is the localised prompt string
 *     (callers either pass a literal or an i18n result).
 *   - `BiometricResult` is a tagged union so consumers can render different
 *     error UIs (toast for `cancelled`, error sheet for `lockedOut`,
 *     "set up Face ID" CTA for `unavailable`).
 *
 * No silent fallback: if `policy.mode === 'biometricOnly'` and the device
 * has no biometric hardware / enrollment, we return `unavailable` rather
 * than letting expo-local-authentication drop to the passcode keypad.
 */
import * as LocalAuthentication from 'expo-local-authentication';

import {
  getSensitivePolicyFor,
  type SensitiveAction,
} from './sensitiveActionPolicy';

export type BiometricSuccessMethod = 'biometric' | 'passcode';

export type BiometricFailureReason =
  | 'cancelled'
  | 'lockedOut'
  | 'unavailable'
  | 'policyDisabled';

export type BiometricResult =
  | { readonly success: true; readonly method: BiometricSuccessMethod }
  | { readonly success: false; readonly reason: BiometricFailureReason };

interface AuthenticateOutcome {
  readonly success: boolean;
  readonly error?: string;
}

async function probeBiometricCapability(): Promise<{
  readonly hasHardware: boolean;
  readonly isEnrolled: boolean;
}> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return { hasHardware, isEnrolled };
}

function classifyError(message: string | undefined): BiometricFailureReason {
  if (!message) return 'cancelled';
  const lower = message.toLowerCase();
  if (lower.includes('lockout') || lower.includes('locked') || lower.includes('too many')) {
    return 'lockedOut';
  }
  if (
    lower.includes('not available') ||
    lower.includes('not enrolled') ||
    lower.includes('no hardware') ||
    lower.includes('unavailable')
  ) {
    return 'unavailable';
  }
  return 'cancelled';
}

/**
 * Gate a sensitive action behind the per-action biometric policy. Returns
 * a typed `BiometricResult` so callers can branch without re-prompting.
 *
 * @param action The Swift-aligned SensitiveAction enum value.
 * @param reason The localised prompt message shown in the OS sheet.
 *               Mirrors Swift `SensitiveAction.prompt`.
 */
export async function requireSensitiveAction(
  action: SensitiveAction,
  reason: string
): Promise<BiometricResult> {
  const policy = getSensitivePolicyFor(action);

  // Short-circuit: user disabled the gate for this action. We surface a
  // `passcode` method label so audit logs distinguish this from an actual
  // biometric pass.
  if (!policy.enabled) {
    return { success: true, method: 'passcode' };
  }

  const capability = await probeBiometricCapability();
  const biometricUsable = capability.hasHardware && capability.isEnrolled;

  if (policy.mode === 'biometricOnly' && !biometricUsable) {
    return { success: false, reason: 'unavailable' };
  }

  const outcome = await prompt(reason, policy.mode === 'biometricOnly');
  if (!outcome.success) {
    return { success: false, reason: classifyError(outcome.error) };
  }

  // expo-local-authentication doesn't tell us which factor satisfied the
  // prompt. We mirror Swift's behaviour: assume biometric when available,
  // otherwise passcode. The distinction matters only for the audit label.
  return {
    success: true,
    method: biometricUsable ? 'biometric' : 'passcode',
  };
}

async function prompt(reason: string, biometricOnly: boolean): Promise<AuthenticateOutcome> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    fallbackLabel: biometricOnly ? '' : 'Use device passcode',
    disableDeviceFallback: biometricOnly,
  });
  if (r.success) return { success: true };
  // r.error is set to e.g. 'user_cancel', 'lockout', 'not_enrolled' on newer SDKs.
  const message =
    (r as unknown as { error?: string }).error ??
    (r as unknown as { warning?: string }).warning;
  return { success: false, error: message };
}

/**
 * Convenience wrapper for call sites that still use the old
 * `requireBiometric(reason) => Promise<boolean>` shape — returns `true`
 * only on real success. Use `requireSensitiveAction` for new code so the
 * caller can react to lockout / unavailable.
 */
export async function requireSensitiveActionBoolean(
  action: SensitiveAction,
  reason: string
): Promise<boolean> {
  const r = await requireSensitiveAction(action, reason);
  return r.success;
}
