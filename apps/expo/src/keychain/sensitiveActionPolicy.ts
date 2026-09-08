/**
 * Biometric gate policy — three named modes, plus a red line no mode disarms.
 *
 * History: this was a per-action store (7 independent `enabled` flags, each
 * with its own `biometricOnly` / `biometricOrPasscode` mode), a 1:1 port of
 * Swift's `SensitiveActionPolicyStore`. That surfaced 16 controls on the
 * Security screen for a decision users have no basis to make. It collapsed to
 * one boolean, and then (2026-09-08) to three modes — because the boolean's
 * "on" was hiding a five-minute grace window the user could neither see nor
 * disable, and its "off" needed a paragraph of exceptions to explain. A named
 * mode carries that meaning in the label instead of the footnote.
 *
 * The per-action `SensitiveAction` enum SURVIVES: it still selects prompt copy
 * and decides red-line membership. Only the user-configurable surface changed.
 *
 * The model:
 *   - `mode` is the single user choice — see `BiometricGateMode`.
 *   - `RED_LINE_ACTIONS` gate in every mode. The rule is irreversibility.
 *   - `everyTime` additionally switches OFF the grace bucket in `biometric.ts`,
 *     which both gates share, so the promise holds across the whole app rather
 *     than only on `requireSensitiveAction` call sites.
 *   - There is no `biometricOnly` mode any more. Every prompt allows the device
 *     passcode as a fallback (what the Swift `LAContext` did by default), so a
 *     user whose Face ID is unenrolled or locked out can never be sealed away
 *     from their own data.
 *
 * `policy` is still exposed as a `Record<SensitiveAction, …>` because
 * `biometricGatekeeper` reads it per action. It is DERIVED from `mode` and
 * served from a per-mode cache, so object identity is stable across reads — a
 * fresh reference per read would retrigger the React 19 `useSyncExternalStore`
 * max-update-depth loop this repo has already been bitten by.
 *
 * DELIBERATE NON-MIGRATIONS — the only gates a mode does not govern:
 *   1. Pear card release (`src/pear/useCardExchange.ts`) stays on
 *      `requireBiometric('cardRelease')`. It hands a signed credential to a
 *      REMOTE peer, so it is a per-peer consent decision, not a device-mode
 *      one: it always prompts and never arms the grace bucket. Routing it
 *      through an optional action would let `redLineOnly` release a card to a
 *      peer with no Face ID at all — the exact regression round 2 of the
 *      2026-06-13 grace fix was written to prevent. By the same
 *      irreversibility rule used for RED_LINE_ACTIONS it IS a red line;
 *      `biometric.ts` already implements precisely that, so it stays there.
 *   2. Nothing else. Every other `requireBiometric` call site was migrated on
 *      2026-09-08 — if you add a new one, migrate it or the Security screen's
 *      copy becomes a lie.
 *
 * Storage:
 *   - MMKV `gg.solidarity.biometric.gate.v3` = `{"mode":"balanced"}`.
 *   - Migrates the v2 boolean and the v1 per-action blob, both fail-CLOSED.
 *   - In-memory defaults so consumers can subscribe BEFORE MMKV is ready
 *     (Rule 8 + Rule 10 — never await on first paint).
 *   - `hydrateSensitiveActionPolicy()` is called from the root layout after
 *     `initMmkv()` resolves to swap in the persisted snapshot.
 */
import { create } from 'zustand';

import { setBiometricGraceEnabled } from './biometric';
import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

const MMKV_KEY = 'gg.solidarity.biometric.gate.v3';
/** Single-boolean shape that briefly preceded the three modes. */
const LEGACY_V2_KEY = 'gg.solidarity.biometric.gate.v2';
/** Pre-2.0.0 per-action blob. Read once for migration, never written again. */
const LEGACY_V1_KEY = 'gg.solidarity.biometric.policy.v1';

/**
 * Sensitive actions that may be gated behind a biometric prompt.
 *
 * Mirrors the Swift `SensitiveAction` enum
 * (`solidarity/Services/Identity/BiometricGatekeeper.swift`):
 *   issueCredential, presentProof, exportGraph, rotateMasterKey,
 *   revealRecoveryBundle, registerTrustAnchor, deleteZKIdentity.
 *
 * Call sites pick a stable action key; lower-level Sec rules from `CLAUDE.md`
 * ("Face ID: passport save, exchange, sign, present, delete, export") map onto
 * the enum as:
 *   passportSave        → issueCredential
 *   cardExchange        → presentProof   (matches Swift "exchange"-flavoured prompt)
 *   sign                → presentProof
 *   presentCredential   → presentProof
 *   deleteVault         → deleteZKIdentity
 *   exportData          → exportGraph
 *   deleteCard          → exportGraph   (access-level: a card is recoverable from
 *                                        a dated archive — NOT deleteZKIdentity,
 *                                        which is a red line)
 *   rotateKeys          → rotateMasterKey
 *   shardDistribute     → revealRecoveryBundle
 */
export type SensitiveAction =
  | 'issueCredential'
  | 'presentProof'
  | 'exportGraph'
  | 'rotateMasterKey'
  | 'revealRecoveryBundle'
  | 'registerTrustAnchor'
  | 'deleteZKIdentity';

export const SENSITIVE_ACTIONS: readonly SensitiveAction[] = [
  'issueCredential',
  'presentProof',
  'exportGraph',
  'rotateMasterKey',
  'revealRecoveryBundle',
  'registerTrustAnchor',
  'deleteZKIdentity',
];

/**
 * The RED LINE: actions gated in EVERY mode, including `redLineOnly`.
 *
 * The rule is irreversibility, not sensitivity. Replacing the signing key,
 * wiping local data and deleting the ZK identity destroy something that cannot
 * be recovered; revealing the recovery phrase hands over the master secret,
 * which is worse than deletion — a leaked phrase is leaked forever, while
 * deleted data may still exist in a backup. Everything else (showing a proof,
 * exporting attestations, unlocking the vault, saving a passport) is
 * access-level and follows the user's mode.
 *
 * `biometricGatekeeper` imports this exact set as its grace-window exemption,
 * so the two can no longer drift: an action too dangerous to ride a five-minute
 * window is exactly an action the mode may not disarm.
 */
export const RED_LINE_ACTIONS: ReadonlySet<SensitiveAction> = new Set([
  'rotateMasterKey',
  'revealRecoveryBundle',
  'deleteZKIdentity',
]);

/** Actions the mode actually governs (the complement of the red line). */
export const OPTIONAL_ACTIONS: readonly SensitiveAction[] = SENSITIVE_ACTIONS.filter(
  (action) => !RED_LINE_ACTIONS.has(action)
);

/**
 * How often the app asks. Three named positions instead of a bare on/off,
 * because "on" was hiding a five-minute grace window the user could neither
 * see nor turn off, and "off" needed a paragraph of exceptions to explain.
 *
 *   everyTime   — every sensitive action authenticates; grace window disabled.
 *   balanced    — one check covers the next five minutes (the default).
 *   redLineOnly — only RED_LINE_ACTIONS authenticate; access-level actions
 *                 (show / export / unlock / save) never prompt.
 */
export type BiometricGateMode = 'everyTime' | 'balanced' | 'redLineOnly';

export const BIOMETRIC_GATE_MODES: readonly BiometricGateMode[] = [
  'everyTime',
  'balanced',
  'redLineOnly',
];

export interface SensitiveActionEntry {
  readonly enabled: boolean;
}

export type SensitiveActionPolicy = Readonly<
  Record<SensitiveAction, SensitiveActionEntry>
>;

/** Fail closed: a fresh install lands on the gated middle position. */
const DEFAULT_MODE: BiometricGateMode = 'balanced';

/**
 * Project the mode onto the per-action record the gatekeeper reads. Red-line
 * actions ignore the mode entirely.
 */
function buildPolicy(mode: BiometricGateMode): SensitiveActionPolicy {
  const gateOptional = mode !== 'redLineOnly';
  const next = {} as Record<SensitiveAction, SensitiveActionEntry>;
  for (const action of SENSITIVE_ACTIONS) {
    next[action] = { enabled: gateOptional || RED_LINE_ACTIONS.has(action) };
  }
  return next;
}

/**
 * One cached snapshot per mode. Returning a cached object (rather than a fresh
 * `buildPolicy` result) keeps `getSensitivePolicySnapshot` referentially stable
 * across reads, which the React-19 selector contract depends on.
 */
const POLICY_BY_MODE: Readonly<Record<BiometricGateMode, SensitiveActionPolicy>> = {
  everyTime: buildPolicy('everyTime'),
  balanced: buildPolicy('balanced'),
  redLineOnly: buildPolicy('redLineOnly'),
};

interface PolicyState {
  /** The user's chosen mode. Red-line actions gate regardless. */
  readonly mode: BiometricGateMode;
  /** Derived from `mode`; what `biometricGatekeeper` reads. */
  readonly policy: SensitiveActionPolicy;
  /** False until `hydrateSensitiveActionPolicy()` has resolved. */
  readonly hydrated: boolean;
  readonly setMode: (mode: BiometricGateMode) => void;
  /** Restore fail-closed defaults after the local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

function isMode(value: unknown): value is BiometricGateMode {
  return value === 'everyTime' || value === 'balanced' || value === 'redLineOnly';
}

/**
 * Push the mode's grace-window consequence into `biometric.ts`, which owns the
 * bucket shared by BOTH gates. Without this, "ask every time" would still be
 * silenced for five minutes on every `requireBiometric` call site.
 */
function applyGraceForMode(mode: BiometricGateMode): void {
  setBiometricGraceEnabled(mode !== 'everyTime');
}

/**
 * Fail-CLOSED migration off the v1 per-action blob.
 *
 * v1 let a user disable each action independently, which a single mode cannot
 * represent. We land on `redLineOnly` only for someone who had disabled EVERY
 * optional action — any surviving `enabled: true` (and any missing or malformed
 * entry) resolves to `balanced`, i.e. to more prompting, never less. The v1
 * `mode` field is dropped on purpose: `biometricOnly` no longer exists.
 *
 * Returns `null` when there is no legacy blob to migrate.
 */
function migrateFromV1(raw: string | undefined): BiometricGateMode | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    // A v1 blob that is not an object (null, a number, a string) tells us
    // nothing about intent — fail closed rather than guess. An array does pass
    // this guard (`typeof [] === 'object'`), and then reads as "every optional
    // action missing", which the `!== false` test also resolves to gated.
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_MODE;
    const entries = parsed as Partial<Record<SensitiveAction, { enabled?: unknown }>>;
    const anyGated = OPTIONAL_ACTIONS.some((action) => entries[action]?.enabled !== false);
    return anyGated ? 'balanced' : 'redLineOnly';
  } catch {
    // Corrupt legacy blob — fail closed rather than silently unlocking.
    return DEFAULT_MODE;
  }
}

/** v2 stored a single boolean before the three modes existed. */
function migrateFromV2(raw: string | undefined): BiometricGateMode | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_MODE;
    const enabled = (parsed as { enabled?: unknown }).enabled;
    if (typeof enabled !== 'boolean') return DEFAULT_MODE;
    return enabled ? 'balanced' : 'redLineOnly';
  } catch {
    return DEFAULT_MODE;
  }
}

/**
 * Read the persisted mode. `{ ok: false }` means MMKV itself was unreadable
 * (not "no record") — the caller must NOT latch `hydrated: true` on that, or a
 * user who chose `redLineOnly` would be shown a fail-closed `balanced` they
 * never chose, with no later attempt to correct it.
 */
function readSafe(): { readonly ok: true; readonly mode: BiometricGateMode } | { readonly ok: false } {
  try {
    const mmkv = getMmkv();
    const raw = mmkv.getString(MMKV_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      const mode = typeof parsed === 'object' && parsed !== null
        ? (parsed as { mode?: unknown }).mode
        : undefined;
      return { ok: true, mode: isMode(mode) ? mode : DEFAULT_MODE };
    }
    // Walk back through the older shapes, newest first.
    const fromV2 = migrateFromV2(mmkv.getString(LEGACY_V2_KEY));
    if (fromV2) return { ok: true, mode: fromV2 };
    const fromV1 = migrateFromV1(mmkv.getString(LEGACY_V1_KEY));
    return { ok: true, mode: fromV1 ?? DEFAULT_MODE };
  } catch {
    return { ok: false };
  }
}

function writeSafe(mode: BiometricGateMode): void {
  try {
    getMmkv().set(MMKV_KEY, JSON.stringify({ mode }));
  } catch {
    // MMKV not ready / disk full — fail closed; in-memory state stays the truth.
  }
}

export const useSensitiveActionPolicy = create<PolicyState>((set) => ({
  mode: DEFAULT_MODE,
  policy: POLICY_BY_MODE[DEFAULT_MODE],
  hydrated: false,
  setMode: (mode) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    writeSafe(mode);
    applyGraceForMode(mode);
    set({ mode, policy: POLICY_BY_MODE[mode] });
  },
  resetForLocalWipe: () => {
    applyGraceForMode(DEFAULT_MODE);
    set({
      mode: DEFAULT_MODE,
      policy: POLICY_BY_MODE[DEFAULT_MODE],
      hydrated: true,
    });
  },
}));

/**
 * Pull the persisted mode into the live store (migrating a v1/v2 record on the
 * way). Call from the root layout after `initMmkv()` resolves. Idempotent.
 *
 * Returns whether the store is now hydrated. Boot calls this from the middle of
 * a `try` block (`app/_layout.tsx`), so a throw earlier in that block skips it
 * entirely and the app still paints via the `catch`. The Security screen
 * therefore retries on mount — without that, `hydrated` would stay false for
 * the whole session and the screen would render its loading row forever.
 */
export function hydrateSensitiveActionPolicy(): boolean {
  if (!canCommitLocalData(captureLocalDataEpoch())) return false;
  const read = readSafe();
  if (!read.ok) return false;
  applyGraceForMode(read.mode);
  useSensitiveActionPolicy.setState({
    mode: read.mode,
    policy: POLICY_BY_MODE[read.mode],
    hydrated: true,
  });
  return true;
}

/** Imperative read (e.g. from inside a non-React callback). */
export function getSensitivePolicySnapshot(): SensitiveActionPolicy {
  return useSensitiveActionPolicy.getState().policy;
}

/** Imperative single-action lookup (used by `biometricGatekeeper.ts`). */
export function getSensitivePolicyFor(action: SensitiveAction): SensitiveActionEntry {
  return useSensitiveActionPolicy.getState().policy[action];
}

/** Test-only — restores the in-memory store. */
export function resetSensitiveActionPolicyForTesting(): void {
  // Skip MMKV.remove() — calling getMmkv() inside a bun test that has a
  // partially-installed module mock can hang the test runner. The
  // in-memory reset is sufficient for tests; the on-device install never
  // calls this path.
  applyGraceForMode(DEFAULT_MODE);
  useSensitiveActionPolicy.setState({
    mode: DEFAULT_MODE,
    policy: POLICY_BY_MODE[DEFAULT_MODE],
    hydrated: false,
  });
}
