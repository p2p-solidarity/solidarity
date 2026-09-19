/**
 * Biometric gate policy — three modes, the red line no mode disarms, and the
 * fail-closed migration off the two older persisted shapes.
 *
 * The user-facing model collapsed on 2026-09-08: 7 per-action toggles (each
 * with a `biometricOnly` / `biometricOrPasscode` mode) became one boolean, then
 * three named modes. The `SensitiveAction` enum survives — it still picks the
 * prompt copy and decides red-line membership — so these pins cover the seams:
 *
 *   1. `SENSITIVE_ACTIONS` still lists all 7; `RED_LINE_ACTIONS` and
 *      `OPTIONAL_ACTIONS` partition them.
 *   2. Fresh install lands on `balanced` (fail closed).
 *   3. `redLineOnly` disables exactly the OPTIONAL actions; every red-line
 *      action still reaches the OS prompt.
 *   4. `RED_LINE_ACTIONS` IS the gatekeeper's grace-window exemption — pinned
 *      behaviourally, so an action can never become disarmable while still
 *      bypassing grace (or vice versa).
 *   5. `everyTime` switches off the grace bucket in `biometric.ts`, which BOTH
 *      gates share — otherwise "ask every time" would be untrue on the
 *      `requireBiometric` call sites.
 *   6. v1 (per-action blob) and v2 (single boolean) both migrate fail CLOSED.
 *   7. `policy` object identity is stable across reads (the React 19
 *      `useSyncExternalStore` max-update-depth tripwire).
 *   8. Failure classification matches expo's real underscore error codes.
 *   9. Both locales carry the copy the collapsed screen renders.
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

type Action =
  | 'issueCredential'
  | 'presentProof'
  | 'exportGraph'
  | 'rotateMasterKey'
  | 'revealRecoveryBundle'
  | 'registerTrustAnchor'
  | 'deleteZKIdentity';

type Mode = 'everyTime' | 'balanced' | 'redLineOnly';

interface PolicyMod {
  readonly SENSITIVE_ACTIONS: readonly Action[];
  readonly RED_LINE_ACTIONS: ReadonlySet<Action>;
  readonly OPTIONAL_ACTIONS: readonly Action[];
  readonly BIOMETRIC_GATE_MODES: readonly Mode[];
  readonly useSensitiveActionPolicy: {
    getState: () => {
      readonly mode: Mode;
      readonly policy: Record<string, { readonly enabled: boolean }>;
      readonly hydrated: boolean;
      readonly setMode: (mode: Mode) => void;
      readonly resetForLocalWipe: () => void;
    };
    setState: (s: unknown) => void;
  };
  readonly getSensitivePolicyFor: (action: string) => { readonly enabled: boolean };
  readonly getSensitivePolicySnapshot: () => Record<string, { readonly enabled: boolean }>;
  readonly hydrateSensitiveActionPolicy: () => boolean;
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

interface BioMod {
  readonly resetBiometricGrace: () => void;
  readonly armBiometricGrace: () => void;
  readonly hasBiometricGrace: () => boolean;
  readonly isBiometricGraceEnabled: () => boolean;
  readonly setBiometricGraceEnabled: (enabled: boolean) => void;
  readonly requireBiometric: (reason: string) => Promise<boolean>;
}

const V1_KEY = 'gg.solidarity.biometric.policy.v1';
const V2_KEY = 'gg.solidarity.biometric.gate.v2';
const V3_KEY = 'gg.solidarity.biometric.gate.v3';

let policyMod: PolicyMod;
let gatekeeper: GatekeeperMod;
let bio: BioMod;
let enLocale: LocaleModule;
let zhHantLocale: LocaleModule;

beforeAll(async () => {
  await mock.module('@/storage/mmkv', () => mmkvMock);
  await mock.module('expo-local-authentication', () => localAuthMock);
  policyMod = (await import('../../src/keychain/sensitiveActionPolicy')) as unknown as PolicyMod;
  gatekeeper = (await import('../../src/keychain/biometricGatekeeper')) as unknown as GatekeeperMod;
  bio = (await import('../../src/keychain/biometric')) as unknown as BioMod;
  enLocale = (await import('../../src/i18n/locales/en.json')) as unknown as LocaleModule;
  zhHantLocale = (await import('../../src/i18n/locales/zh-Hant.json')) as unknown as LocaleModule;
});

beforeEach(() => {
  kv.clear();
  authCalls.length = 0;
  nextAuthResult = { success: true };
  hasHwResult = true;
  isEnrolledResult = true;
  bio.setBiometricGraceEnabled(true);
  bio.resetBiometricGrace();
  policyMod.resetSensitiveActionPolicyForTesting();
});

afterEach(() => {
  // No state to tear down between tests; defaults already restore in beforeEach.
});

// ── 1. The action set and its partition ─────────────────────────────────────

describe('SensitiveAction set', () => {
  const allActions: readonly Action[] = [
    'issueCredential',
    'presentProof',
    'exportGraph',
    'rotateMasterKey',
    'revealRecoveryBundle',
    'registerTrustAnchor',
    'deleteZKIdentity',
  ];

  it('SENSITIVE_ACTIONS still lists exactly the 7 actions', () => {
    expect([...policyMod.SENSITIVE_ACTIONS].sort()).toEqual([...allActions].sort());
  });

  it('RED_LINE_ACTIONS is the irreversible trio', () => {
    const expected: readonly Action[] = [
      'deleteZKIdentity',
      'revealRecoveryBundle',
      'rotateMasterKey',
    ];
    expect([...policyMod.RED_LINE_ACTIONS].sort()).toEqual([...expected].sort());
  });

  it('RED_LINE and OPTIONAL partition SENSITIVE_ACTIONS with no overlap or gap', () => {
    const optional = [...policyMod.OPTIONAL_ACTIONS];
    const redLine = [...policyMod.RED_LINE_ACTIONS];
    expect(optional.filter((a) => policyMod.RED_LINE_ACTIONS.has(a))).toEqual([]);
    expect([...optional, ...redLine].sort()).toEqual([...allActions].sort());
  });

  it('BIOMETRIC_GATE_MODES is ordered strongest to weakest', () => {
    // The Security screen derives "is this a weakening?" from index order, and
    // only weakening requires authentication. Reordering silently would let a
    // user drop to redLineOnly with no prompt.
    expect([...policyMod.BIOMETRIC_GATE_MODES]).toEqual([
      'everyTime',
      'balanced',
      'redLineOnly',
    ]);
  });
});

// ── 2 + 3. Modes, and the red line they cannot disarm ──────────────────────

describe('gate modes', () => {
  it('defaults to balanced — a fresh install is gated (fail closed)', () => {
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
    for (const action of policyMod.SENSITIVE_ACTIONS) {
      expect(policyMod.getSensitivePolicyFor(action).enabled).toBe(true);
    }
  });

  it('everyTime gates every action', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('everyTime');
    for (const action of policyMod.SENSITIVE_ACTIONS) {
      expect(policyMod.getSensitivePolicyFor(action).enabled).toBe(true);
    }
  });

  it('redLineOnly disables exactly the OPTIONAL actions', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    for (const action of policyMod.OPTIONAL_ACTIONS) {
      expect(policyMod.getSensitivePolicyFor(action).enabled).toBe(false);
    }
  });

  it('redLineOnly leaves every red-line action gated', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    for (const action of policyMod.RED_LINE_ACTIONS) {
      expect(policyMod.getSensitivePolicyFor(action).enabled).toBe(true);
    }
  });

  it('a red-line action still reaches the OS prompt in redLineOnly', async () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    for (const action of policyMod.RED_LINE_ACTIONS) {
      authCalls.length = 0;
      bio.resetBiometricGrace();
      const r = await gatekeeper.requireSensitiveAction(action, `do ${action}`);
      expect(r.success).toBe(true);
      expect(authCalls.length).toBe(1);
    }
  });

  it('an optional action short-circuits without prompting in redLineOnly', async () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    for (const action of policyMod.OPTIONAL_ACTIONS) {
      authCalls.length = 0;
      const r = await gatekeeper.requireSensitiveAction(action, `do ${action}`);
      expect(r.success).toBe(true);
      if (r.success) expect(r.method).toBe('passcode');
      expect(authCalls.length).toBe(0);
    }
  });

  it('resetForLocalWipe restores the fail-closed default', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    policyMod.useSensitiveActionPolicy.getState().resetForLocalWipe();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('persists across a relaunch (round-trip through MMKV)', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    policyMod.resetSensitiveActionPolicyForTesting();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
    expect(policyMod.hydrateSensitiveActionPolicy()).toBe(true);
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('redLineOnly');
    expect(policyMod.useSensitiveActionPolicy.getState().hydrated).toBe(true);
  });
});

// ── 4. RED_LINE_ACTIONS == the gatekeeper's grace exemption ────────────────

describe('RED_LINE_ACTIONS matches the gatekeeper grace-window exemption', () => {
  it('every red-line action prompts even inside an armed grace window', async () => {
    for (const action of policyMod.RED_LINE_ACTIONS) {
      bio.resetBiometricGrace();
      bio.armBiometricGrace();
      authCalls.length = 0;
      const r = await gatekeeper.requireSensitiveAction(action, `do ${action}`);
      expect(r.success).toBe(true);
      expect(authCalls.length).toBe(1);
    }
  });

  it('every optional action is silenced by an armed grace window', async () => {
    for (const action of policyMod.OPTIONAL_ACTIONS) {
      bio.resetBiometricGrace();
      bio.armBiometricGrace();
      authCalls.length = 0;
      const r = await gatekeeper.requireSensitiveAction(action, `do ${action}`);
      expect(r.success).toBe(true);
      expect(authCalls.length).toBe(0);
    }
  });

  it('a red-line action succeeding does NOT open the family window', async () => {
    for (const action of policyMod.RED_LINE_ACTIONS) {
      bio.resetBiometricGrace();
      await gatekeeper.requireSensitiveAction(action, `do ${action}`);
      expect(bio.hasBiometricGrace()).toBe(false);
    }
  });
});

// ── 5. everyTime kills the grace bucket — for BOTH gates ───────────────────

describe('everyTime disables the shared grace window', () => {
  it('selecting everyTime turns the grace bucket off', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('everyTime');
    expect(bio.isBiometricGraceEnabled()).toBe(false);
  });

  it('selecting balanced turns it back on', () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('everyTime');
    policyMod.useSensitiveActionPolicy.getState().setMode('balanced');
    expect(bio.isBiometricGraceEnabled()).toBe(true);
  });

  it('switching to everyTime drops a window that is already open', () => {
    bio.armBiometricGrace();
    expect(bio.hasBiometricGrace()).toBe(true);
    policyMod.useSensitiveActionPolicy.getState().setMode('everyTime');
    expect(bio.hasBiometricGrace()).toBe(false);
  });

  it('an optional action prompts EVERY time under everyTime', async () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('everyTime');
    await gatekeeper.requireSensitiveAction('presentProof', 'present');
    await gatekeeper.requireSensitiveAction('presentProof', 'present again');
    expect(authCalls.length).toBe(2);
  });

  it('the policy-blind requireBiometric gate also stops arming the bucket', async () => {
    // The bucket is shared, so everyTime has to reach `requireBiometric` too —
    // otherwise "ask every time" would be a lie on the Pear card-release path.
    // Asserted via the bucket rather than the auth-call count: `mock.module` is
    // process-global in bun, so a sibling test file can re-register the
    // expo-local-authentication mock and steal `authCalls` from under us.
    policyMod.useSensitiveActionPolicy.getState().setMode('everyTime');
    await bio.requireBiometric('sign');
    expect(bio.hasBiometricGrace()).toBe(false);
  });

  it('hydrating a persisted everyTime re-applies the grace consequence', () => {
    kv.set(V3_KEY, JSON.stringify({ mode: 'everyTime' }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(bio.isBiometricGraceEnabled()).toBe(false);
  });
});

// ── 6. Migration off both older shapes, fail closed ────────────────────────

describe('migration off the older persisted shapes', () => {
  const ALL_OFF = {
    issueCredential: { enabled: false },
    presentProof: { enabled: false },
    exportGraph: { enabled: false },
    registerTrustAnchor: { enabled: false },
    rotateMasterKey: { enabled: false },
    revealRecoveryBundle: { enabled: false },
    deleteZKIdentity: { enabled: false },
  } as const;

  it('v1: a user who had disabled every optional action lands on redLineOnly', () => {
    kv.set(V1_KEY, JSON.stringify(ALL_OFF));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('redLineOnly');
  });

  it('v1: one surviving optional action lands on balanced (fail closed)', () => {
    kv.set(V1_KEY, JSON.stringify({ ...ALL_OFF, presentProof: { enabled: true } }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('v1: red-line-only flags do NOT by themselves force a gated mode', () => {
    // The trio gates regardless, so their v1 values carry no information about
    // what the user wanted for the optional family.
    kv.set(V1_KEY, JSON.stringify({ ...ALL_OFF, rotateMasterKey: { enabled: true } }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('redLineOnly');
  });

  it('v1: a missing optional entry counts as gated (fail closed)', () => {
    const partial = { ...ALL_OFF } as Record<string, { enabled: boolean }>;
    delete partial['exportGraph'];
    kv.set(V1_KEY, JSON.stringify(partial));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('v1: a corrupt blob falls back to balanced', () => {
    kv.set(V1_KEY, '{not json');
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('v2: enabled true becomes balanced', () => {
    kv.set(V2_KEY, JSON.stringify({ enabled: true }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('v2: enabled false becomes redLineOnly', () => {
    kv.set(V2_KEY, JSON.stringify({ enabled: false }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('redLineOnly');
  });

  it('v2 wins over a staler v1 blob', () => {
    kv.set(V1_KEY, JSON.stringify(ALL_OFF));
    kv.set(V2_KEY, JSON.stringify({ enabled: true }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('v3 wins over both older shapes', () => {
    kv.set(V1_KEY, JSON.stringify(ALL_OFF));
    kv.set(V2_KEY, JSON.stringify({ enabled: false }));
    kv.set(V3_KEY, JSON.stringify({ mode: 'everyTime' }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('everyTime');
  });

  it('an unrecognised mode string falls back to balanced', () => {
    kv.set(V3_KEY, JSON.stringify({ mode: 'yolo' }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });

  it('no stored record at all defaults to balanced', () => {
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('balanced');
  });
});

// ── requireSensitiveAction — prompt plumbing ───────────────────────────────

describe('requireSensitiveAction: prompting', () => {
  it('passes the caller-supplied reason through as the OS prompt message', async () => {
    await gatekeeper.requireSensitiveAction('issueCredential', 'reason text');
    expect(authCalls[0]?.promptMessage).toBe('reason text');
  });

  it('always offers the device passcode as a fallback (no biometricOnly mode)', async () => {
    await gatekeeper.requireSensitiveAction('issueCredential', 'sign it');
    expect(authCalls[0]?.disableDeviceFallback).toBe(false);
    expect(authCalls[0]?.fallbackLabel).toBe('Use device passcode');
  });

  it('still prompts (passcode path) when no biometric is enrolled — never sealed out', async () => {
    hasHwResult = false;
    isEnrolledResult = false;
    const r = await gatekeeper.requireSensitiveAction('presentProof', 'present');
    expect(authCalls.length).toBe(1);
    expect(r.success).toBe(true);
    if (r.success) expect(r.method).toBe('passcode');
  });

  it('a failed prompt does NOT arm the grace bucket', async () => {
    nextAuthResult = { success: false };
    const r = await gatekeeper.requireSensitiveAction('presentProof', 'present');
    expect(r.success).toBe(false);
    expect(bio.hasBiometricGrace()).toBe(false);
  });

  it('a cold optional success arms the bucket for the rest of the family', async () => {
    expect(bio.hasBiometricGrace()).toBe(false);
    const r = await gatekeeper.requireSensitiveAction('presentProof', 'present');
    expect(r.success).toBe(true);
    expect(authCalls.length).toBe(1);
    expect(bio.hasBiometricGrace()).toBe(true);
  });

  it('the redLineOnly short-circuit does NOT arm the bucket', async () => {
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    const r = await gatekeeper.requireSensitiveAction('presentProof', 'present');
    expect(r.success).toBe(true);
    expect(authCalls.length).toBe(0);
    expect(bio.hasBiometricGrace()).toBe(false);
  });
});

// ── 8. classifyError — expo reports UNDERSCORE codes, not prose ────────────

describe('failure classification maps expo LocalAuthenticationError codes', () => {
  const CASES: readonly (readonly [string, 'cancelled' | 'lockedOut' | 'unavailable'])[] = [
    ['user_cancel', 'cancelled'],
    ['app_cancel', 'cancelled'],
    ['system_cancel', 'cancelled'],
    ['authentication_failed', 'cancelled'],
    ['lockout', 'lockedOut'],
    ['lockout_permanent', 'lockedOut'],
    ['not_enrolled', 'unavailable'],
    ['not_available', 'unavailable'],
    ['passcode_not_set', 'unavailable'],
  ];

  for (const [code, expected] of CASES) {
    it(`'${code}' classifies as ${expected}`, async () => {
      nextAuthResult = { success: false, error: code };
      const r = await gatekeeper.requireSensitiveAction('presentProof', 'present');
      expect(r.success).toBe(false);
      if (!r.success) expect(r.reason).toBe(expected);
    });
  }

  it('a user who can never authenticate is NOT told they cancelled', async () => {
    // The regression this pins: `not_enrolled` used to fall through the
    // space-separated substring checks straight to 'cancelled', so a device
    // with no enrolled biometric and no passcode showed "Authentication was
    // cancelled." to someone who never cancelled and physically cannot pass.
    nextAuthResult = { success: false, error: 'passcode_not_set' };
    const r = await gatekeeper.requireSensitiveAction('rotateMasterKey', 'rotate');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.reason).not.toBe('cancelled');
  });
});

// ── Hydration must not latch a fail-closed default over the user's choice ──

describe('hydrateSensitiveActionPolicy: failure reporting', () => {
  it('reports success and marks the store hydrated when MMKV is readable', () => {
    expect(policyMod.hydrateSensitiveActionPolicy()).toBe(true);
    expect(policyMod.useSensitiveActionPolicy.getState().hydrated).toBe(true);
  });

  it('a stored redLineOnly survives hydration rather than being overwritten', () => {
    kv.set(V3_KEY, JSON.stringify({ mode: 'redLineOnly' }));
    policyMod.hydrateSensitiveActionPolicy();
    expect(policyMod.useSensitiveActionPolicy.getState().mode).toBe('redLineOnly');
    expect(policyMod.useSensitiveActionPolicy.getState().hydrated).toBe(true);
  });
});

// ── 7. Snapshot stability — the React 19 selector tripwire ─────────────────

describe('policy snapshot stability', () => {
  it('returns the SAME object reference across 10 reads when unchanged', () => {
    const first = policyMod.getSensitivePolicySnapshot();
    for (let i = 0; i < 10; i += 1) {
      expect(Object.is(policyMod.getSensitivePolicySnapshot(), first)).toBe(true);
    }
  });

  it('per-action entries are also stable across reads', () => {
    const first = policyMod.getSensitivePolicyFor('presentProof');
    expect(Object.is(policyMod.getSensitivePolicyFor('presentProof'), first)).toBe(true);
  });

  it('the reference flips only when the mode actually changes', () => {
    const before = policyMod.getSensitivePolicySnapshot();
    policyMod.useSensitiveActionPolicy.getState().setMode('balanced'); // no-op value
    expect(Object.is(policyMod.getSensitivePolicySnapshot(), before)).toBe(true);
    policyMod.useSensitiveActionPolicy.getState().setMode('redLineOnly');
    expect(Object.is(policyMod.getSensitivePolicySnapshot(), before)).toBe(false);
  });
});

// ── 9. i18n — the copy the collapsed screen renders ────────────────────────

describe('i18n: security copy present in en + zh-Hant', () => {
  const SCREEN_KEYS = [
    'security.title',
    'security.header',
    'security.subtitle',
    'security.section.protection',
    'security.mode.everyTime.title',
    'security.mode.everyTime.subtitle',
    'security.mode.balanced.title',
    'security.mode.balanced.subtitle',
    'security.mode.redLineOnly.title',
    'security.mode.redLineOnly.subtitle',
    'security.gate.footer',
    'security.gate.loading',
    'security.section.keyRotation',
    'security.section.keyRotationFooter',
    'security.action.rotateMasterKeyTitle',
    'security.prompt.weakenGate',
  ];

  for (const key of SCREEN_KEYS) {
    it(`en + zh-Hant both define ${key}`, () => {
      for (const locale of [readLocale(enLocale), readLocale(zhHantLocale)]) {
        expect(typeof locale[key]).toBe('string');
        expect(locale[key]?.length ?? 0).toBeGreaterThan(0);
      }
    });
  }

  it('every action keeps a prompt string in both locales (gate call sites use it)', () => {
    const en = readLocale(enLocale);
    const zh = readLocale(zhHantLocale);
    for (const action of [
      'issueCredential',
      'presentProof',
      'exportGraph',
      'rotateMasterKey',
      'revealRecoveryBundle',
      'registerTrustAnchor',
      'deleteZKIdentity',
    ]) {
      expect((en[`security.prompt.${action}`]?.length ?? 0) > 0).toBe(true);
      expect((zh[`security.prompt.${action}`]?.length ?? 0) > 0).toBe(true);
    }
  });

  it('every BiometricResult failure reason has error copy in both locales', () => {
    const en = readLocale(enLocale);
    const zh = readLocale(zhHantLocale);
    for (const reason of ['cancelled', 'lockedOut', 'unavailable', 'policyDisabled']) {
      expect((en[`security.error.${reason}`]?.length ?? 0) > 0).toBe(true);
      expect((zh[`security.error.${reason}`]?.length ?? 0) > 0).toBe(true);
    }
  });

  it('drops the per-action label + old boolean keys the picker no longer renders', () => {
    const en = readLocale(enLocale);
    for (const dead of [
      'security.label.presentProof',
      'security.mode.biometricOnly',
      'security.mode.biometricOrPasscode',
      'security.resetDefaults',
      'security.section.requirements',
      'security.gate.title',
      'security.gate.subtitle',
      'security.prompt.disableGate',
    ]) {
      expect(en[dead]).toBeUndefined();
    }
  });
});
