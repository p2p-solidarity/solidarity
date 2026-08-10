/**
 * Per-action biometric policy store.
 *
 * Mirrors Swift `SensitiveActionPolicyStore` (`solidarity/Services/Identity/
 * SensitiveActionPolicyStore.swift`) and the action enum from
 * `BiometricGatekeeper.swift`. Swift stores a single `Bool` per action in
 * the Keychain; the TS port keeps the same defaults (all actions require
 * biometric) but adds an explicit `mode` knob so the UI can offer
 * "biometric only" (no passcode fallback) for the high-stakes actions
 * (matches the LAPolicy split Swift performs at the LAContext layer).
 *
 * Storage:
 *   - MMKV-backed (`gg.solidarity.biometric.policy.v1`).
 *   - In-memory defaults so consumers can subscribe BEFORE MMKV is ready
 *     (Rule 8 + Rule 10 — never await on first paint).
 *   - `hydrateSensitiveActionPolicy()` is called from the root layout after
 *     `initMmkv()` resolves to swap in the persisted snapshot.
 *
 * Concurrency note (avoid the recent identity infinite-loop bug):
 *   - All slices are returned with stable references. `setPolicy` /
 *     `togglePolicy` only swap the entry that changed, so other slice
 *     subscribers don't re-render.
 *   - `useSensitivePolicy(action)` is an atomic selector — callers wrap the
 *     downstream derivation in `useMemo` if they need a freshly-derived
 *     object per action (see `app/settings/security.tsx`).
 */
import { useMemo } from 'react';
import { create } from 'zustand';

import { getMmkv } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';

const MMKV_KEY = 'gg.solidarity.biometric.policy.v1';

/**
 * Sensitive actions that may be gated behind a biometric prompt.
 *
 * Mirrors the Swift `SensitiveAction` enum
 * (`solidarity/Services/Identity/BiometricGatekeeper.swift`):
 *   issueCredential, presentProof, exportGraph, rotateMasterKey,
 *   revealRecoveryBundle, registerTrustAnchor, deleteZKIdentity.
 *
 * The TS port additionally surfaces lower-level Sec rules from
 * `CLAUDE.md` ("Face ID: passport save, exchange, sign, present, delete,
 * export") so every call site can pick a stable action key without falling
 * back to an unrelated label. Down-the-road actions (passportSave,
 * cardExchange, sign, presentCredential, deleteVault, exportData,
 * rotateKeys, shardDistribute) map onto the Swift enum at the call site:
 *   passportSave        → issueCredential
 *   cardExchange        → presentProof   (matches Swift "exchange"-flavoured prompt)
 *   sign                → presentProof
 *   presentCredential   → presentProof
 *   deleteVault         → deleteZKIdentity
 *   exportData          → exportGraph
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

export type BiometricMode = 'biometricOnly' | 'biometricOrPasscode';

export interface SensitiveActionEntry {
  readonly enabled: boolean;
  readonly mode: BiometricMode;
}

export type SensitiveActionPolicy = Readonly<
  Record<SensitiveAction, SensitiveActionEntry>
>;

/**
 * Mirrors Swift `SensitiveActionPolicyStore.init` defaults: every action
 * starts requiring biometric (`enabled: true`). LAContext falls back to the
 * passcode automatically when biometrics are unavailable, so the default
 * mode is `biometricOrPasscode` — matches `BiometricGatekeeper.authorize`.
 */
function buildDefaultPolicy(): SensitiveActionPolicy {
  const next = {} as Record<SensitiveAction, SensitiveActionEntry>;
  for (const action of SENSITIVE_ACTIONS) {
    next[action] = { enabled: true, mode: 'biometricOrPasscode' };
  }
  return next;
}

const DEFAULT_POLICY: SensitiveActionPolicy = buildDefaultPolicy();

interface PolicyState {
  readonly policy: SensitiveActionPolicy;
  /** False until `hydrateSensitiveActionPolicy()` has resolved. */
  readonly hydrated: boolean;
  readonly setPolicy: (action: SensitiveAction, entry: SensitiveActionEntry) => void;
  readonly togglePolicy: (action: SensitiveAction) => void;
  readonly resetToDefaults: () => void;
  /** Restore fail-closed defaults after the local store is wiped. */
  readonly resetForLocalWipe: () => void;
}

function readSafe(): SensitiveActionPolicy {
  try {
    const raw = getMmkv().getString(MMKV_KEY);
    if (!raw) return DEFAULT_POLICY;
    const parsed = JSON.parse(raw) as Partial<Record<SensitiveAction, Partial<SensitiveActionEntry>>>;
    const next = {} as Record<SensitiveAction, SensitiveActionEntry>;
    for (const action of SENSITIVE_ACTIONS) {
      const stored = parsed[action];
      const fallback = DEFAULT_POLICY[action];
      next[action] = {
        enabled: typeof stored?.enabled === 'boolean' ? stored.enabled : fallback.enabled,
        mode:
          stored?.mode === 'biometricOnly' || stored?.mode === 'biometricOrPasscode'
            ? stored.mode
            : fallback.mode,
      };
    }
    return next;
  } catch {
    return DEFAULT_POLICY;
  }
}

function writeSafe(policy: SensitiveActionPolicy): void {
  try {
    getMmkv().set(MMKV_KEY, JSON.stringify(policy));
  } catch {
    // MMKV not ready / disk full — fail closed; in-memory state stays the truth.
  }
}

export const useSensitiveActionPolicy = create<PolicyState>((set, get) => ({
  policy: DEFAULT_POLICY,
  hydrated: false,
  setPolicy: (action, entry) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    set((s) => {
      const next: SensitiveActionPolicy = { ...s.policy, [action]: entry };
      writeSafe(next);
      return { policy: next };
    });
  },
  togglePolicy: (action) => {
    const current = get().policy[action];
    get().setPolicy(action, { ...current, enabled: !current.enabled });
  },
  resetToDefaults: () => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    writeSafe(DEFAULT_POLICY);
    set({ policy: DEFAULT_POLICY });
  },
  resetForLocalWipe: () => {
    set({ policy: buildDefaultPolicy(), hydrated: true });
  },
}));

/**
 * Pull the persisted policy snapshot into the live store. Call once from
 * the root layout, after `initMmkv()` has resolved. Safe to call multiple
 * times — idempotent.
 */
export function hydrateSensitiveActionPolicy(): void {
  if (!canCommitLocalData(captureLocalDataEpoch())) return;
  const persisted = readSafe();
  useSensitiveActionPolicy.setState({ policy: persisted, hydrated: true });
}

/**
 * Atomic-slice selector — returns the stable entry reference for `action`.
 * Wrap any derivation in `useMemo` to avoid the
 * `useSyncExternalStore` infinite-loop tripwire.
 */
export function useSensitivePolicy(action: SensitiveAction): SensitiveActionEntry {
  const entry = useSensitiveActionPolicy((s) => s.policy[action]);
  return useMemo(() => entry, [entry]);
}

/** Imperative read (e.g. from inside a non-React callback). */
export function getSensitivePolicySnapshot(): SensitiveActionPolicy {
  return useSensitiveActionPolicy.getState().policy;
}

/** Imperative single-action lookup (used by `biometricGatekeeper.ts`). */
export function getSensitivePolicyFor(action: SensitiveAction): SensitiveActionEntry {
  return useSensitiveActionPolicy.getState().policy[action];
}

/** Test-only — restores the in-memory store + clears MMKV. */
export function resetSensitiveActionPolicyForTesting(): void {
  // Skip MMKV.remove() — calling getMmkv() inside a bun test that has a
  // partially-installed module mock can hang the test runner. The
  // in-memory reset is sufficient for tests; the on-device install never
  // calls this path.
  useSensitiveActionPolicy.setState({ policy: buildDefaultPolicy(), hydrated: false });
}
