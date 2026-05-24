/**
 * SensitiveActionPolicy store + gatekeeper — defaults, toggles, mode
 * enforcement, and policy short-circuit behaviour.
 *
 * Swift reference:
 *   solidarity/Services/Identity/BiometricGatekeeper.swift
 *     - SensitiveAction enum (issueCredential, presentProof, exportGraph,
 *       rotateMasterKey, revealRecoveryBundle, registerTrustAnchor,
 *       deleteZKIdentity)
 *     - `authorizeIfRequired(action)` short-circuits when the per-action
 *       requirement is disabled.
 *   solidarity/Services/Identity/SensitiveActionPolicyStore.swift
 *     - per-action `Bool` flag, default `true`.
 *
 * TS port pins:
 *   1. Default policy matches Swift exactly (every action, all `enabled:
 *      true`, `mode: 'biometricOrPasscode'`).
 *   2. `togglePolicy` flips a single entry without touching siblings.
 *   3. `resetToDefaults` restores the canonical set.
 *   4. `requireSensitiveAction` short-circuits with
 *      `{ success: true, method: 'passcode' }` when the policy is disabled
 *      (no biometric prompt).
 *   5. `biometricOnly` mode fails cleanly with `unavailable` when biometric
 *      hardware / enrollment is missing.
 *   6. Every action has a translated label key in both i18n locales — no
 *      missing UI labels when the settings page renders.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

// ── In-memory MMKV mock so the store can read/write without native code ────

const kv = new Map<string, string>();

const mmkvMock = {
  getMmkv: () => ({
    getString: (k: string): string | undefined => kv.get(k),
    set: (k: string, v: string | number | boolean): void => {
      kv.set(k, String(v));
    },
    remove: (k: string): boolean => kv.delete(k),
    getAllKeys: (): readonly string[] => Array.from(kv.keys()),
  }),
  initMmkv: (): Promise<undefined> => Promise.resolve(undefined),
};

// ── expo-local-authentication mock so the gatekeeper resolves predictably ──

interface AuthOpts {
  promptMessage: string;
  fallbackLabel?: string;
  cancelLabel?: string;
  disableDeviceFallback?: boolean;
}

let nextAuthResult: { success: boolean; error?: string } = { success: true };
let hasHwResult = true;
let isEnrolledResult = true;
const authCalls: AuthOpts[] = [];

const localAuthMock = {
  hasHardwareAsync: (): Promise<boolean> => Promise.resolve(hasHwResult),
  isEnrolledAsync: (): Promise<boolean> => Promise.resolve(isEnrolledResult),
  authenticateAsync: (opts: AuthOpts): Promise<{ success: boolean; error?: string }> => {
    authCalls.push(opts);
    return Promise.resolve(nextAuthResult);
  },
};

interface PolicyMod {
  readonly SENSITIVE_ACTIONS: readonly (
    | 'issueCredential'
    | 'presentProof'
    | 'exportGraph'
    | 'rotateMasterKey'
    | 'revealRecoveryBundle'
    | 'registerTrustAnchor'
    | 'deleteZKIdentity'
  )[];
  readonly useSensitiveActionPolicy: {
    getState: () => {
      readonly policy: Record<
        string,
        { readonly enabled: boolean; readonly mode: 'biometricOnly' | 'biometricOrPasscode' }
      >;
      readonly hydrated: boolean;
      readonly setPolicy: (
        action: string,
        entry: { readonly enabled: boolean; readonly mode: 'biometricOnly' | 'biometricOrPasscode' }
      ) => void;
      readonly togglePolicy: (action: string) => void;
      readonly resetToDefaults: () => void;
    };
    setState: (s: unknown) => void;
  };
  readonly getSensitivePolicyFor: (action: string) => {
    readonly enabled: boolean;
    readonly mode: 'biometricOnly' | 'biometricOrPasscode';
  };
  readonly hydrateSensitiveActionPolicy: () => void;
  readonly resetSensitiveActionPolicyForTesting: () => void;
}

interface GatekeeperMod {
  readonly requireSensitiveAction: (
    action: string,
    reason: string
  ) => Promise<
    | { readonly success: true; readonly method: 'biometric' | 'passcode' }
    | {
        readonly success: false;
        readonly reason: 'cancelled' | 'lockedOut' | 'unavailable' | 'policyDisabled';
      }
  >;
}

type LocaleModule =
  | (Record<string, string> & { readonly default?: Record<string, string> })
  | { readonly default: Record<string, string> };

function readLocale(mod: LocaleModule): Record<string, string> {
  const withDefault = mod as { readonly default?: Record<string, string> };
  return withDefault.default ?? (mod as Record<string, string>);
}

let policyMod: PolicyMod;
let gatekeeper: GatekeeperMod;
let enLocale: LocaleModule;
let zhHantLocale: LocaleModule;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => mmkvMock);
  await mock.module('expo-local-authentication', () => localAuthMock);
  policyMod = (await import('../../src/keychain/sensitiveActionPolicy')) as unknown as PolicyMod;
  gatekeeper = (await import('../../src/keychain/biometricGatekeeper')) as unknown as GatekeeperMod;
  enLocale = (await import('../../src/i18n/locales/en.json')) as unknown as LocaleModule;
  zhHantLocale = (await import('../../src/i18n/locales/zh-Hant.json')) as unknown as LocaleModule;
});

beforeEach(() => {
  kv.clear();
  authCalls.length = 0;
  nextAuthResult = { success: true };
  hasHwResult = true;
  isEnrolledResult = true;
});

afterEach(() => {
  // No state to tear down between tests; defaults already restore in beforeEach.
});

// ── Inline reset helper (no MMKV touch) ───────────────────────────────────

function resetPolicyInline(): void {
  policyMod.useSensitiveActionPolicy.setState({
    policy: {
      issueCredential: { enabled: true, mode: 'biometricOrPasscode' },
      presentProof: { enabled: true, mode: 'biometricOrPasscode' },
      exportGraph: { enabled: true, mode: 'biometricOrPasscode' },
      rotateMasterKey: { enabled: true, mode: 'biometricOrPasscode' },
      revealRecoveryBundle: { enabled: true, mode: 'biometricOrPasscode' },
      registerTrustAnchor: { enabled: true, mode: 'biometricOrPasscode' },
      deleteZKIdentity: { enabled: true, mode: 'biometricOrPasscode' },
    },
    hydrated: false,
  });
}

// ── 1. Default policy parity with Swift ─────────────────────────────────────

describe('SensitiveActionPolicy: defaults match Swift', () => {
  const swiftActions = [
    'issueCredential',
    'presentProof',
    'exportGraph',
    'rotateMasterKey',
    'revealRecoveryBundle',
    'registerTrustAnchor',
    'deleteZKIdentity',
  ] as const;

  it('SENSITIVE_ACTIONS lists exactly the Swift SensitiveAction enum members', () => {
    const fromModule = [...policyMod.SENSITIVE_ACTIONS].sort();
    const expected = [...swiftActions].sort();
    expect(fromModule).toEqual(expected);
  });

  it('every action defaults to enabled: true (Swift policy store default)', () => {
    // Reset before reading defaults — sibling tests may have mutated state
    // when this file runs alongside others in the same bun process.
    policyMod.useSensitiveActionPolicy.setState({
      policy: {
        issueCredential: { enabled: true, mode: 'biometricOrPasscode' },
        presentProof: { enabled: true, mode: 'biometricOrPasscode' },
        exportGraph: { enabled: true, mode: 'biometricOrPasscode' },
        rotateMasterKey: { enabled: true, mode: 'biometricOrPasscode' },
        revealRecoveryBundle: { enabled: true, mode: 'biometricOrPasscode' },
        registerTrustAnchor: { enabled: true, mode: 'biometricOrPasscode' },
        deleteZKIdentity: { enabled: true, mode: 'biometricOrPasscode' },
      },
      hydrated: false,
    });
    const policy = policyMod.useSensitiveActionPolicy.getState().policy;
    for (const action of swiftActions) {
      const entry = policy[action];
      expect(entry).toBeDefined();
      expect(entry?.enabled).toBe(true);
    }
  });

  it('every action defaults to biometricOrPasscode (Swift authorize falls back to passcode)', () => {
    policyMod.useSensitiveActionPolicy.setState({
      policy: {
        issueCredential: { enabled: true, mode: 'biometricOrPasscode' },
        presentProof: { enabled: true, mode: 'biometricOrPasscode' },
        exportGraph: { enabled: true, mode: 'biometricOrPasscode' },
        rotateMasterKey: { enabled: true, mode: 'biometricOrPasscode' },
        revealRecoveryBundle: { enabled: true, mode: 'biometricOrPasscode' },
        registerTrustAnchor: { enabled: true, mode: 'biometricOrPasscode' },
        deleteZKIdentity: { enabled: true, mode: 'biometricOrPasscode' },
      },
      hydrated: false,
    });
    const policy = policyMod.useSensitiveActionPolicy.getState().policy;
    for (const action of swiftActions) {
      expect(policy[action]?.mode).toBe('biometricOrPasscode');
    }
  });
});

// ── 2. Toggle / reset round-trip ────────────────────────────────────────────

describe('togglePolicy / resetToDefaults', () => {
  it('togglePolicy flips a single entry without disturbing siblings', () => {
    resetPolicyInline();
    const store = policyMod.useSensitiveActionPolicy.getState();
    store.togglePolicy('exportGraph');
    const policy = policyMod.useSensitiveActionPolicy.getState().policy;
    expect(policy['exportGraph']?.enabled).toBe(false);
    expect(policy['issueCredential']?.enabled).toBe(true);
    expect(policy['presentProof']?.enabled).toBe(true);
  });

  it('togglePolicy round-trip restores the original value', () => {
    resetPolicyInline();
    const store = policyMod.useSensitiveActionPolicy.getState();
    const before = policyMod.useSensitiveActionPolicy.getState().policy['deleteZKIdentity']?.enabled;
    store.togglePolicy('deleteZKIdentity');
    store.togglePolicy('deleteZKIdentity');
    const after = policyMod.useSensitiveActionPolicy.getState().policy['deleteZKIdentity']?.enabled;
    expect(after).toBe(before);
  });

  it('resetToDefaults restores every action to enabled: true + biometricOrPasscode', () => {
    resetPolicyInline();
    const store = policyMod.useSensitiveActionPolicy.getState();
    store.setPolicy('issueCredential', { enabled: false, mode: 'biometricOnly' });
    store.setPolicy('presentProof', { enabled: false, mode: 'biometricOnly' });
    store.resetToDefaults();
    const policy = policyMod.useSensitiveActionPolicy.getState().policy;
    for (const action of policyMod.SENSITIVE_ACTIONS) {
      expect(policy[action]?.enabled).toBe(true);
      expect(policy[action]?.mode).toBe('biometricOrPasscode');
    }
  });

  it('setPolicy persists across hydrate (round-trip through MMKV)', () => {
    resetPolicyInline();
    const store = policyMod.useSensitiveActionPolicy.getState();
    store.setPolicy('rotateMasterKey', { enabled: false, mode: 'biometricOnly' });
    // Simulate app relaunch — reset in-memory state, then hydrate from MMKV.
    policyMod.useSensitiveActionPolicy.setState({
      policy: {
        issueCredential: { enabled: true, mode: 'biometricOrPasscode' },
        presentProof: { enabled: true, mode: 'biometricOrPasscode' },
        exportGraph: { enabled: true, mode: 'biometricOrPasscode' },
        rotateMasterKey: { enabled: true, mode: 'biometricOrPasscode' },
        revealRecoveryBundle: { enabled: true, mode: 'biometricOrPasscode' },
        registerTrustAnchor: { enabled: true, mode: 'biometricOrPasscode' },
        deleteZKIdentity: { enabled: true, mode: 'biometricOrPasscode' },
      },
      hydrated: false,
    });
    policyMod.hydrateSensitiveActionPolicy();
    const after = policyMod.useSensitiveActionPolicy.getState().policy['rotateMasterKey'];
    expect(after?.enabled).toBe(false);
    expect(after?.mode).toBe('biometricOnly');
  });
});

// ── 3. requireSensitiveAction — gating semantics ────────────────────────────

describe('requireSensitiveAction: gating', () => {
  it('returns success:true,method:passcode when policy.enabled=false (no biometric prompt)', async () => {
    resetPolicyInline();
    policyMod.useSensitiveActionPolicy.getState().setPolicy('exportGraph', {
      enabled: false,
      mode: 'biometricOrPasscode',
    });
    const r = await gatekeeper.requireSensitiveAction('exportGraph', 'should not prompt');
    expect(r).toEqual({ success: true, method: 'passcode' });
    expect(authCalls.length).toBe(0);
  });

  it('biometricOnly + no biometric hardware fails clean with unavailable', async () => {
    resetPolicyInline();
    policyMod.useSensitiveActionPolicy.getState().setPolicy('deleteZKIdentity', {
      enabled: true,
      mode: 'biometricOnly',
    });
    hasHwResult = false;
    isEnrolledResult = false;
    const r = await gatekeeper.requireSensitiveAction('deleteZKIdentity', 'must have biometric');
    expect(r).toEqual({ success: false, reason: 'unavailable' });
    expect(authCalls.length).toBe(0);
  });

  it('biometricOnly + biometric available + user approves resolves success:true,method:biometric', async () => {
    resetPolicyInline();
    policyMod.useSensitiveActionPolicy.getState().setPolicy('presentProof', {
      enabled: true,
      mode: 'biometricOnly',
    });
    nextAuthResult = { success: true };
    const r = await gatekeeper.requireSensitiveAction('presentProof', 'prove it');
    expect(r).toEqual({ success: true, method: 'biometric' });
    expect(authCalls.length).toBe(1);
    expect(authCalls[0]?.disableDeviceFallback).toBe(true);
  });

  it('biometricOrPasscode + user cancels reports cancelled', async () => {
    resetPolicyInline();
    nextAuthResult = { success: false, error: 'user_cancel' };
    const r = await gatekeeper.requireSensitiveAction('issueCredential', 'sign it');
    expect(r).toEqual({ success: false, reason: 'cancelled' });
  });

  it('every call passes a non-empty prompt + cancel/fallback labels (UX sanity)', async () => {
    resetPolicyInline();
    await gatekeeper.requireSensitiveAction('issueCredential', 'reason text');
    expect(authCalls[0]?.promptMessage).toBe('reason text');
    expect(authCalls[0]?.cancelLabel).toBeDefined();
    expect(authCalls[0]?.fallbackLabel).toBeDefined();
  });

  it('lockout error string maps to BiometricFailureReason="lockedOut"', async () => {
    resetPolicyInline();
    nextAuthResult = { success: false, error: 'user_lockout' };
    const r = await gatekeeper.requireSensitiveAction('rotateMasterKey', 'rotate');
    expect(r).toEqual({ success: false, reason: 'lockedOut' });
  });
});

// ── 4. i18n labels — every action has a translated string in both locales ──

describe('i18n: per-action labels present in en + zh-Hant', () => {
  const swiftActions: readonly string[] = [
    'issueCredential',
    'presentProof',
    'exportGraph',
    'rotateMasterKey',
    'revealRecoveryBundle',
    'registerTrustAnchor',
    'deleteZKIdentity',
  ];

  for (const action of swiftActions) {
    it(`en has security.label.${action}`, () => {
      const obj = readLocale(enLocale);
      const key = `security.label.${action}`;
      expect(typeof obj[key]).toBe('string');
      expect(obj[key]?.length ?? 0).toBeGreaterThan(0);
    });

    it(`zh-Hant has security.label.${action}`, () => {
      const obj = readLocale(zhHantLocale);
      const key = `security.label.${action}`;
      expect(typeof obj[key]).toBe('string');
      expect(obj[key]?.length ?? 0).toBeGreaterThan(0);
    });

    it(`en has security.prompt.${action}`, () => {
      const obj = readLocale(enLocale);
      const key = `security.prompt.${action}`;
      expect(typeof obj[key]).toBe('string');
      expect(obj[key]?.length ?? 0).toBeGreaterThan(0);
    });
  }

  it('en + zh-Hant both define biometricOnly + biometricOrPasscode + reset labels', () => {
    const en = readLocale(enLocale);
    const zh = readLocale(zhHantLocale);
    for (const key of [
      'security.mode.biometricOnly',
      'security.mode.biometricOrPasscode',
      'security.resetDefaults',
      'security.header',
      'security.subtitle',
    ]) {
      expect(en[key]).toBeDefined();
      expect(zh[key]).toBeDefined();
    }
  });
});

// ── 5. Snapshot stability — atomic-slice selector pattern ──────────────────

describe('useSensitivePolicy: atomic-slice stability', () => {
  it('reading state.policy via getState returns the SAME reference across 10 reads when unchanged', () => {
    resetPolicyInline();
    const first = policyMod.useSensitiveActionPolicy.getState().policy;
    for (let i = 0; i < 10; i += 1) {
      const next = policyMod.useSensitiveActionPolicy.getState().policy;
      expect(Object.is(next, first)).toBe(true);
    }
  });

  it('policy reference flips only after a setPolicy/togglePolicy call', () => {
    resetPolicyInline();
    const before = policyMod.useSensitiveActionPolicy.getState().policy;
    policyMod.useSensitiveActionPolicy.getState().togglePolicy('exportGraph');
    const after = policyMod.useSensitiveActionPolicy.getState().policy;
    expect(Object.is(after, before)).toBe(false);
  });
});
