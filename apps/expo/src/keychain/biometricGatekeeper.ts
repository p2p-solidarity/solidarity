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
 * Every prompt allows the device passcode as a fallback. The old
 * `biometricOnly` mode (which returned `unavailable` instead of showing the
 * passcode keypad) was removed with the per-action settings UI in 2026-09-08:
 * it could seal a user out of their own data the moment Face ID was
 * unenrolled or locked out, and it was never the default.
 */
import * as LocalAuthentication from 'expo-local-authentication';

import { armBiometricGrace, hasBiometricGrace } from './biometric';
import {
  RED_LINE_ACTIONS,
  getSensitivePolicyFor,
  type SensitiveAction,
} from './sensitiveActionPolicy';

/**
 * Destructive / recovery-secret actions never ride the shared grace bucket
 * (aggressive policy, 2026-06-13): they re-prompt every time and their
 * success does not open the family window.
 *
 * This is `RED_LINE_ACTIONS` itself, not a copy of it. The two concepts are
 * the same rule seen from two sides — an action too dangerous to ride a
 * five-minute window is exactly an action the user's mode may not disarm — and
 * keeping one identifier means they cannot drift apart in a later edit.
 */
const ALWAYS_PROMPT_ACTIONS: ReadonlySet<SensitiveAction> = RED_LINE_ACTIONS;

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

/**
 * expo-local-authentication reports UNDERSCORE codes on `result.error`
 * (`LocalAuthenticationError` = 'not_enrolled' | 'user_cancel' | 'not_available'
 * | 'lockout' | 'passcode_not_set' | 'authentication_failed' | …), not prose.
 * Matching only space-separated phrases meant every capability failure fell
 * through to `cancelled` — telling a user who physically CANNOT authenticate
 * that they cancelled, with no way forward. Exact codes are checked first; the
 * substring pass is kept for older SDK message strings.
 */
const CANCEL_CODES: ReadonlySet<string> = new Set([
  'user_cancel',
  'app_cancel',
  'system_cancel',
  'user_fallback',
]);
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'not_enrolled',
  'not_available',
  'passcode_not_set',
  'no_space',
]);
const LOCKOUT_CODES: ReadonlySet<string> = new Set(['lockout', 'lockout_permanent']);

function classifyError(message: string | undefined): BiometricFailureReason {
  if (!message) return 'cancelled';
  const code = message.toLowerCase().trim();
  if (LOCKOUT_CODES.has(code)) return 'lockedOut';
  if (UNAVAILABLE_CODES.has(code)) return 'unavailable';
  if (CANCEL_CODES.has(code)) return 'cancelled';
  if (code.includes('lockout') || code.includes('locked') || code.includes('too many')) {
    return 'lockedOut';
  }
  if (
    code.includes('not available') ||
    code.includes('not enrolled') ||
    code.includes('no hardware') ||
    code.includes('passcode not set') ||
    code.includes('unavailable')
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
  // biometric pass. Does NOT arm the grace bucket — no auth happened.
  if (!policy.enabled) {
    return { success: true, method: 'passcode' };
  }

  // Shared grace bucket: a recent successful gate (this module or
  // biometric.ts) covers the whole non-destructive family — one prompt per
  // user session. Destructive actions always reach the OS sheet.
  if (!ALWAYS_PROMPT_ACTIONS.has(action) && hasBiometricGrace()) {
    return { success: true, method: 'biometric' };
  }

  const capability = await probeBiometricCapability();
  const biometricUsable = capability.hasHardware && capability.isEnrolled;

  const outcome = await prompt(reason);
  if (!outcome.success) {
    return { success: false, reason: classifyError(outcome.error) };
  }

  if (!ALWAYS_PROMPT_ACTIONS.has(action)) {
    armBiometricGrace();
  }

  // expo-local-authentication doesn't tell us which factor satisfied the
  // prompt. We mirror Swift's behaviour: assume biometric when available,
  // otherwise passcode. The distinction matters only for the audit label.
  return {
    success: true,
    method: biometricUsable ? 'biometric' : 'passcode',
  };
}

async function prompt(reason: string): Promise<AuthenticateOutcome> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    cancelLabel: 'Cancel',
    fallbackLabel: 'Use device passcode',
    disableDeviceFallback: false,
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
