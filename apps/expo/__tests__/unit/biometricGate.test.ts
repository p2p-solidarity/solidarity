/**
 * Biometric gate — protects every Face ID / Touch ID-required action.
 *
 * Swift reference:
 *   solidarity/Services/Identity/BiometricGatekeeper.swift
 *     - SensitiveAction enum: issueCredential, presentProof, exportGraph,
 *       rotateMasterKey, revealRecoveryBundle, registerTrustAnchor,
 *       deleteZKIdentity
 *     - authorize(action, completion:) prompts then calls back with Result
 *   solidarity/Services/Identity/KeychainService.swift
 *     - signingKey() / sign() are biometric-gated via Keychain
 *       SecAccessControl (.userPresence). Each access re-prompts because
 *       touchIDAuthenticationAllowableReuseDuration is 0.
 *
 * TS port:
 *   apps/expo/src/keychain/biometric.ts    — `requireBiometric(reason)`
 *   apps/expo/src/keychain/signingKey.ts   — `signJwt(...)` calls
 *                                              `requireBiometric('sign')`
 *
 * Per project CLAUDE.md Sec rules: Face ID is required for passport save,
 * exchange, sign, present, delete, and export. This test pins:
 *   1. `requireBiometric(reason)` calls `authenticateAsync` with a non-empty
 *      `promptMessage` (covers every BiometricReason).
 *   2. `requireBiometric` returns `true` only when the OS reports
 *      `success: true`, and `false` on user cancel / failure.
 *   3. `signJwt` invokes `requireBiometric('sign')` BEFORE touching the
 *      signing key — denying biometrics MUST throw (never silently sign).
 *   4. The full reason → prompt mapping is exhaustive (every reason has a
 *      distinct, non-empty prompt — catches a future enum drift).
 *
 * Reasons covered (from `BiometricReason` union):
 *   sign | export | present | delete | exchange | passportSave
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  hexToBytes,
  publicKeyFromPrivate,
} from '@solidarity/shared';
import type { publicKeyToJwk } from '@solidarity/shared';

import type { BiometricReason } from '../../src/keychain/biometric';

// ── Mock the expo native modules so the keychain module loads in bun ────────

interface AuthCallArgs {
  promptMessage: string;
  fallbackLabel?: string;
  cancelLabel?: string;
  disableDeviceFallback?: boolean;
}

interface LocalAuthMockShape {
  readonly hasHardwareAsync: () => Promise<boolean>;
  readonly isEnrolledAsync: () => Promise<boolean>;
  readonly authenticateAsync: (opts: AuthCallArgs) => Promise<{ success: boolean }>;
}

const authCalls: AuthCallArgs[] = [];

let nextAuthResult: { success: boolean } = { success: true };
let hasHwResult = true;
let isEnrolledResult = true;

const localAuthMock: LocalAuthMockShape = {
  hasHardwareAsync: () => Promise.resolve(hasHwResult),
  isEnrolledAsync: () => Promise.resolve(isEnrolledResult),
  authenticateAsync: (opts) => {
    authCalls.push(opts);
    return Promise.resolve(nextAuthResult);
  },
};

const FIXED_PRIV = hexToBytes(
  '1111111122222222333333334444444455555555666666667777777788888888'
);

// SecureStore mock that always returns the FIXED_PRIV so signJwt() can
// reach the actual signing path without hitting native code.
const STORED_PRIV_B64 = Buffer.from(FIXED_PRIV).toString('base64');
const secureStoreMock = {
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: (): Promise<string> => Promise.resolve(STORED_PRIV_B64),
  setItemAsync: (): Promise<void> => Promise.resolve(undefined),
  deleteItemAsync: (): Promise<void> => Promise.resolve(undefined),
};

interface BiometricMod {
  readonly requireBiometric: (reason: BiometricReason) => Promise<boolean>;
  readonly isBiometricAvailable: () => Promise<boolean>;
  readonly resetBiometricGrace: () => void;
}

interface SigningMod {
  readonly ensureSigningKey: () => Promise<{
    readonly privateKey: Uint8Array;
    readonly publicKey: Uint8Array;
  }>;
  readonly publicJwk: () => Promise<ReturnType<typeof publicKeyToJwk>>;
  readonly signJwt: (
    header: { alg: 'ES256'; typ?: string; kid?: string },
    payload: Readonly<Record<string, unknown>>
  ) => Promise<string>;
}

let bio: BiometricMod;
let signing: SigningMod;

beforeAll(async () => {
  await mock.module('expo-local-authentication', () => localAuthMock);
  await mock.module('expo-secure-store', () => secureStoreMock);
  bio = (await import('../../src/keychain/biometric')) as unknown as BiometricMod;
  signing = (await import('../../src/keychain/signingKey')) as unknown as SigningMod;
});

beforeEach(() => {
  authCalls.length = 0;
  nextAuthResult = { success: true };
  hasHwResult = true;
  isEnrolledResult = true;
  // The signing grace persists across calls within the process; clear it so
  // each test starts from a cold "must prompt" state.
  bio.resetBiometricGrace();
});

afterEach(() => {
  // Quick sanity: every call into authenticateAsync should have a non-empty
  // promptMessage — there's no scenario where an empty prompt would be UX
  // correct, and an empty string would silently bypass user awareness.
  for (const c of authCalls) {
    expect(typeof c.promptMessage).toBe('string');
    expect(c.promptMessage.length).toBeGreaterThan(0);
  }
});

// ── requireBiometric: surface contract ──────────────────────────────────────

describe('requireBiometric: invokes expo-local-authentication with a prompt', () => {
  const reasons: readonly BiometricReason[] = [
    'sign',
    'export',
    'present',
    'delete',
    'exchange',
    'passportSave',
  ];

  for (const reason of reasons) {
    it(`prompt is non-empty for reason="${reason}"`, async () => {
      nextAuthResult = { success: true };
      const ok = await bio.requireBiometric(reason);
      expect(ok).toBe(true);
      expect(authCalls.length).toBe(1);
      expect(authCalls[0]?.promptMessage.length).toBeGreaterThan(0);
    });
  }

  it('every BiometricReason produces a unique prompt (no copy-paste collisions)', async () => {
    const prompts = new Set<string>();
    for (const reason of reasons) {
      authCalls.length = 0;
      await bio.requireBiometric(reason);
      prompts.add(authCalls[0]?.promptMessage ?? '');
    }
    expect(prompts.size).toBe(reasons.length);
  });

  it('passes a cancelLabel and a fallbackLabel so the OS sheet is fully labelled', async () => {
    await bio.requireBiometric('sign');
    expect(authCalls[0]?.cancelLabel).toBeDefined();
    expect(authCalls[0]?.fallbackLabel).toBeDefined();
  });
});

describe('requireBiometric: pass / fail return value', () => {
  it('returns true when the OS reports success', async () => {
    nextAuthResult = { success: true };
    expect(await bio.requireBiometric('sign')).toBe(true);
  });

  it('returns false when the OS reports failure (user cancel / timeout)', async () => {
    nextAuthResult = { success: false };
    expect(await bio.requireBiometric('sign')).toBe(false);
  });

  it('returns false on a denied delete attempt (matches Swift authorize flow)', async () => {
    nextAuthResult = { success: false };
    expect(await bio.requireBiometric('delete')).toBe(false);
  });
});

// ── Session grace: sign authorizes once per window, reused silently ─────────

describe('requireBiometric: session grace for signing', () => {
  it('a second sign within the grace window does NOT re-prompt the OS', async () => {
    nextAuthResult = { success: true };
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(1);
    // The share/QR flow re-signs on every field toggle. Within the grace
    // window the second sign reuses the prior authorization — no OS sheet.
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(1);
  });

  it('grace is scoped to "sign" — delete still prompts every time', async () => {
    await bio.requireBiometric('sign'); // opens the grace window
    authCalls.length = 0;
    expect(await bio.requireBiometric('delete')).toBe(true);
    // Destructive actions are never graced: deleting must always re-auth.
    expect(authCalls.length).toBe(1);
  });

  it('a failed sign does NOT open a grace window', async () => {
    nextAuthResult = { success: false };
    expect(await bio.requireBiometric('sign')).toBe(false);
    expect(authCalls.length).toBe(1);
    nextAuthResult = { success: true };
    // No grace was set, so the next sign has to prompt again.
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(2);
  });

  it('resetBiometricGrace() forces the next sign to prompt', async () => {
    await bio.requireBiometric('sign'); // sets grace
    bio.resetBiometricGrace();
    authCalls.length = 0;
    await bio.requireBiometric('sign');
    expect(authCalls.length).toBe(1);
  });
});

describe('isBiometricAvailable: hardware + enrollment gate', () => {
  it('true when both hardware present and biometric enrolled', async () => {
    hasHwResult = true;
    isEnrolledResult = true;
    expect(await bio.isBiometricAvailable()).toBe(true);
  });

  it('false when the device has no biometric hardware', async () => {
    hasHwResult = false;
    isEnrolledResult = true;
    expect(await bio.isBiometricAvailable()).toBe(false);
  });

  it('false when biometric hardware exists but the user has not enrolled', async () => {
    hasHwResult = true;
    isEnrolledResult = false;
    expect(await bio.isBiometricAvailable()).toBe(false);
  });
});

// ── signJwt: ALWAYS gates through requireBiometric ──────────────────────────

describe('signJwt: biometric gate on signing operations', () => {
  it('signJwt prompts requireBiometric BEFORE producing a JWT', async () => {
    nextAuthResult = { success: true };
    const jwt = await signing.signJwt(
      { alg: 'ES256', typ: 'JWT' },
      { sub: 'alice', iat: 1700000000 }
    );
    expect(authCalls.length).toBe(1);
    expect(authCalls[0]?.promptMessage).toMatch(/sign/i);
    // JWT has three dot-separated parts: header.payload.signature.
    expect(jwt.split('.').length).toBe(3);
  });

  it('signJwt throws when biometric fails — never silently signs', async () => {
    nextAuthResult = { success: false };
    let captured: Error | null = null;
    try {
      await signing.signJwt({ alg: 'ES256' }, { sub: 'alice' });
    } catch (e) {
      captured = e as Error;
    }
    expect(captured).not.toBeNull();
    expect(captured?.message).toMatch(/biometric|authentication/i);
  });

  it('publicJwk is NOT gated (read-only, no sensitive material exposed)', async () => {
    // publicJwk just reads the master key + derives the public point. Per
    // Swift KeychainService.publicJwk: no biometric required (Keychain
    // access fetches the SecKey without auth context).
    nextAuthResult = { success: true };
    authCalls.length = 0;
    const jwk = await signing.publicJwk();
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    // Zero biometric prompts during a read-only call.
    expect(authCalls.length).toBe(0);
  });

  it('ensureSigningKey is NOT gated on read (Keychain returns the key the OS unlocked)', async () => {
    nextAuthResult = { success: true };
    authCalls.length = 0;
    const kp = await signing.ensureSigningKey();
    expect(kp.publicKey.length).toBe(65);
    expect(authCalls.length).toBe(0);
  });
});

// ── Defence in depth: the public-key contract is stable across biometric prompts ─

describe('biometric flow does NOT mutate the signing key material', () => {
  it('two successful signJwt calls produce the same public key', async () => {
    nextAuthResult = { success: true };
    const kpBefore = (await signing.ensureSigningKey()).publicKey;
    await signing.signJwt({ alg: 'ES256' }, { sub: 'a' });
    await signing.signJwt({ alg: 'ES256' }, { sub: 'b' });
    const kpAfter = (await signing.ensureSigningKey()).publicKey;
    expect(Buffer.from(kpAfter).toString('hex'))
      .toBe(Buffer.from(kpBefore).toString('hex'));
  });

  it('a denied signJwt does NOT mutate the public key', async () => {
    const kpBefore = (await signing.ensureSigningKey()).publicKey;
    nextAuthResult = { success: false };
    try {
      await signing.signJwt({ alg: 'ES256' }, { sub: 'a' });
    } catch {
      // expected
    }
    nextAuthResult = { success: true };
    const kpAfter = (await signing.ensureSigningKey()).publicKey;
    expect(Buffer.from(kpAfter).toString('hex'))
      .toBe(Buffer.from(kpBefore).toString('hex'));
    // Confirm the public key matches the fixed seed pin.
    const expected = Buffer.from(publicKeyFromPrivate(FIXED_PRIV)).toString('hex');
    expect(Buffer.from(kpAfter).toString('hex')).toBe(expected);
  });
});
