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
 * Shared session grace (aggressive policy, 2026-06-13 — see
 * docs/superpowers/plans/2026-06-13-faceid-single-gate-phase4.md).
 *
 * ONE bucket covers the whole non-destructive family: a successful
 * authorization for sign / export / present / exchange / passportSave
 * silences the entire family for `GRACE_MS` — one Face ID per user
 * session, not one per operation. `'delete'` is the only always-prompt
 * reason: destructive actions re-auth every time and never arm the bucket.
 *
 * `biometricGatekeeper.requireSensitiveAction` shares this bucket via
 * `armBiometricGrace()` / `hasBiometricGrace()`, so an OID4VP
 * `presentProof` gate also covers the `sign` inside `buildVpToken`.
 *
 * Time-based so it always auto-expires; call `resetBiometricGrace()` on
 * sign-out / app background for a hard reset.
 */
const GRACE_MS = 5 * 60 * 1000;
const ALWAYS_PROMPT: ReadonlySet<BiometricReason> = new Set(['delete']);
let graceUntil = 0;
let promptInFlight: Promise<boolean> | null = null;

/** Drop any active grace so the next sensitive action re-prompts. */
export function resetBiometricGrace(): void {
  graceUntil = 0;
  promptInFlight = null;
}

/** Open the shared grace window (called after any equivalent gate succeeds). */
export function armBiometricGrace(): void {
  graceUntil = Date.now() + GRACE_MS;
}

/** Whether the shared grace window is currently open. */
export function hasBiometricGrace(): boolean {
  return Date.now() < graceUntil;
}

/**
 * Prompt the user. Resolves to `true` on success, `false` on cancel/fail.
 * Callers should treat false as "user denied" and abort the sensitive op.
 */
export async function requireBiometric(reason: BiometricReason): Promise<boolean> {
  if (ALWAYS_PROMPT.has(reason)) {
    return authenticate(reason);
  }
  if (hasBiometricGrace()) return true;
  if (promptInFlight) return promptInFlight;
  promptInFlight = authenticate(reason).finally(() => {
    promptInFlight = null;
  });
  return promptInFlight;
}

async function authenticate(reason: BiometricReason): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: PROMPT_BY_REASON[reason],
    fallbackLabel: 'Use device passcode',
    disableDeviceFallback: false,
    cancelLabel: 'Cancel',
  });
  if (r.success && !ALWAYS_PROMPT.has(reason)) {
    armBiometricGrace();
  }
  return r.success;
}
