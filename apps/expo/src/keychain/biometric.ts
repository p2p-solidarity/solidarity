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
  | 'passportSave'
  | 'cardRelease';

const PROMPT_BY_REASON: Readonly<Record<BiometricReason, string>> = {
  sign: 'Authorize signing with your identity key',
  export: 'Authorize exporting your private data',
  present: 'Authorize presenting your credentials',
  delete: 'Authorize deleting protected items',
  exchange: 'Authorize a peer credential exchange',
  passportSave: 'Authorize saving your passport credential',
  cardRelease: 'Approve sharing your card',
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
 * authorization for sign / export / present / passportSave / exchange
 * silences the entire family for `GRACE_MS` — one Face ID per user session,
 * not one per operation. `'delete'` and `'cardRelease'` are always-prompt
 * reasons: destructive actions and remote-peer credential release re-auth
 * every time and never arm the bucket.
 *
 * `'cardRelease'` is a DEDICATED reason (task A5.2 round 2) for the Pear
 * responder's card-release gate — it hands a signed credential to a REMOTE
 * peer, a peer-scoped consent decision, not a same-device, same-session
 * action like `sign`/`export`/`present`/`exchange`. Riding a grace window
 * armed by an unrelated `sign` a few minutes earlier (e.g. the mutual
 * handshake that necessarily precedes any Pear card exchange) would let a
 * `card.request` release the card with NO live Face ID at all, so
 * `cardRelease` always live-prompts and never arms the bucket.
 *
 * Round 1 of this fix moved the existing `'exchange'` reason into
 * `ALWAYS_PROMPT` instead of adding a new reason. That was wrong: `'exchange'`
 * is ALSO used by `vault/secretsKeychain.ts`'s root-secret unwrap gate
 * (reached from local vault unlock, not a remote peer at all), so vault
 * unlock silently lost its 5-minute grace and started live-prompting on
 * every unlock — an unintended UX regression on a shipped, purely-local
 * feature. Round 2 introduces `'cardRelease'` for the Pear path and returns
 * `'exchange'` to the graced family so vault unlock behaves as before.
 *
 * `biometricGatekeeper.requireSensitiveAction` shares this bucket via
 * `armBiometricGrace()` / `hasBiometricGrace()`, so an OID4VP
 * `presentProof` gate also covers the `sign` inside `buildVpToken`.
 *
 * Time-based so it always auto-expires; call `resetBiometricGrace()` on
 * sign-out / app background for a hard reset.
 */
const GRACE_MS = 5 * 60 * 1000;
const ALWAYS_PROMPT: ReadonlySet<BiometricReason> = new Set(['delete', 'cardRelease']);
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
