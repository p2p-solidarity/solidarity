/**
 * Biometric gate — protects every Face ID / Touch ID-required action.
 *
 * Swift reference:
 *   solidarity/Services/Identity/BiometricGatekeeper.swift
 *
 * TS port under test: apps/expo/src/keychain/biometric.ts
 *
 * Policy (2026-06-13, owner-approved AGGRESSIVE tiering — see
 * docs/superpowers/plans/2026-06-13-faceid-single-gate-phase4.md; amended
 * for the Pear connection-scoping security fix, task A5.2, across two
 * rounds):
 *   - ONE shared 5-minute grace bucket covers the same-device,
 *     same-session family (sign / export / present / passportSave /
 *     exchange): a single successful authorization silences the whole
 *     family for the window.
 *   - 'delete' and 'cardRelease' ALWAYS prompt and never arm the bucket.
 *     'cardRelease' releases a signed credential to a REMOTE peer over
 *     Pear — riding a grace window armed by an unrelated `sign` would let a
 *     `card.request` release the card with no live Face ID at all.
 *   - Round 1 mistakenly moved the existing 'exchange' reason into
 *     ALWAYS_PROMPT, which also stripped grace from `vault/secretsKeychain.ts`'s
 *     unrelated local root-secret unwrap (same reason string, different
 *     call site). Round 2 introduces the dedicated 'cardRelease' reason for
 *     the Pear path and returns 'exchange' to the graced family.
 *   - `armBiometricGrace()` / `hasBiometricGrace()` expose the bucket so
 *     `biometricGatekeeper.requireSensitiveAction` shares it.
 *
 * NB: signJwt/signRawEs256 gating lives in signingKey.ts and is covered by
 * the spruce-did wiring tests (test-driver injected) — this file pins the
 * biometric.ts surface only, so it loads without native modules.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import type { BiometricReason } from '../../src/keychain/biometric';

interface AuthCallArgs {
  promptMessage: string;
  fallbackLabel?: string;
  cancelLabel?: string;
  disableDeviceFallback?: boolean;
}

const authCalls: AuthCallArgs[] = [];

let nextAuthResult: { success: boolean } = { success: true };
let hasHwResult = true;
let isEnrolledResult = true;

interface BiometricMod {
  readonly requireBiometric: (reason: BiometricReason) => Promise<boolean>;
  readonly isBiometricAvailable: () => Promise<boolean>;
  readonly resetBiometricGrace: () => void;
  readonly armBiometricGrace: () => void;
  readonly hasBiometricGrace: () => boolean;
}

let bio: BiometricMod;

beforeAll(async () => {
  await mock.module('expo-local-authentication', () => ({
    hasHardwareAsync: () => Promise.resolve(hasHwResult),
    isEnrolledAsync: () => Promise.resolve(isEnrolledResult),
    authenticateAsync: (opts: AuthCallArgs) => {
      authCalls.push(opts);
      return Promise.resolve(nextAuthResult);
    },
  }));
  bio = (await import('../../src/keychain/biometric')) as unknown as BiometricMod;
});

beforeEach(() => {
  authCalls.length = 0;
  nextAuthResult = { success: true };
  hasHwResult = true;
  isEnrolledResult = true;
  // The grace bucket persists across calls within the process; clear it so
  // each test starts from a cold "must prompt" state.
  bio.resetBiometricGrace();
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
    'cardRelease',
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
      // Shared grace bucket: a prior success would silence later reasons —
      // reset so every reason actually reaches the OS sheet.
      bio.resetBiometricGrace();
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

// ── Session grace: one authorization per window, reused silently ────────────

describe('requireBiometric: session grace', () => {
  it('a second sign within the grace window does NOT re-prompt the OS', async () => {
    nextAuthResult = { success: true };
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(1);
    // The share/QR flow re-signs on every field toggle. Within the grace
    // window the second sign reuses the prior authorization — no OS sheet.
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(1);
  });

  it('delete still prompts every time, even inside an armed window', async () => {
    await bio.requireBiometric('sign'); // opens the grace window
    authCalls.length = 0;
    expect(await bio.requireBiometric('delete')).toBe(true);
    // Destructive actions are never graced: deleting must always re-auth.
    expect(authCalls.length).toBe(1);
  });

  it('cardRelease still prompts every time, even inside an armed window (card-release fresh-prompt fix)', async () => {
    await bio.requireBiometric('sign'); // opens the grace window (e.g. the handshake challenge-response)
    authCalls.length = 0;
    expect(await bio.requireBiometric('cardRelease')).toBe(true);
    // Releasing a card to a remote peer must always re-auth, even though a
    // 'sign' moments earlier (the mutual handshake) armed the shared grace
    // bucket — see the module-doc policy note above.
    expect(authCalls.length).toBe(1);
  });

  it('a second exchange within the grace window does NOT re-prompt (vault unlock keeps its grace)', async () => {
    await bio.requireBiometric('sign'); // opens the grace window
    authCalls.length = 0;
    // 'exchange' rejoined the graced family in round 2 of the A5.2 fix —
    // vault root-secret unwrap (`vault/secretsKeychain.ts`) must not
    // live-prompt on every unlock just because an unrelated Pear card
    // release also used to share this reason string.
    expect(await bio.requireBiometric('exchange')).toBe(true);
    expect(authCalls.length).toBe(0);
  });

  it('a failed auth does NOT open a grace window', async () => {
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

// ── Shared grace bucket: one prompt covers the whole non-destructive family ─

describe('requireBiometric: shared grace bucket (aggressive policy)', () => {
  it('a successful sign silences export/present/passportSave/exchange within the window', async () => {
    nextAuthResult = { success: true };
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(1);
    for (const reason of ['export', 'present', 'passportSave', 'exchange'] as const) {
      expect(await bio.requireBiometric(reason)).toBe(true);
    }
    // Still only the one original prompt — the bucket covered all of them.
    expect(authCalls.length).toBe(1);
  });

  it('a successful sign does NOT silence cardRelease — card release always re-prompts', async () => {
    nextAuthResult = { success: true };
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(1);
    expect(await bio.requireBiometric('cardRelease')).toBe(true);
    expect(authCalls.length).toBe(2);
  });

  it('a successful export arms the bucket for a later sign', async () => {
    nextAuthResult = { success: true };
    await bio.requireBiometric('export');
    authCalls.length = 0;
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(0);
  });

  it('delete success does NOT arm the bucket', async () => {
    nextAuthResult = { success: true };
    await bio.requireBiometric('delete');
    authCalls.length = 0;
    await bio.requireBiometric('sign');
    expect(authCalls.length).toBe(1);
  });

  it('cardRelease success does NOT arm the bucket', async () => {
    nextAuthResult = { success: true };
    await bio.requireBiometric('cardRelease');
    authCalls.length = 0;
    await bio.requireBiometric('sign');
    expect(authCalls.length).toBe(1);
  });

  it('exchange success DOES arm the bucket (rejoined the graced family)', async () => {
    nextAuthResult = { success: true };
    await bio.requireBiometric('exchange');
    authCalls.length = 0;
    await bio.requireBiometric('sign');
    expect(authCalls.length).toBe(0);
  });

  it('armBiometricGrace()/hasBiometricGrace() expose the bucket to the gatekeeper', async () => {
    expect(bio.hasBiometricGrace()).toBe(false);
    bio.armBiometricGrace();
    expect(bio.hasBiometricGrace()).toBe(true);
    authCalls.length = 0;
    expect(await bio.requireBiometric('sign')).toBe(true);
    expect(authCalls.length).toBe(0);
    bio.resetBiometricGrace();
    expect(bio.hasBiometricGrace()).toBe(false);
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
