import { beforeEach, describe, expect, it, mock } from 'bun:test';

interface AuthCallArgs {
  promptMessage: string;
  fallbackLabel?: string;
  cancelLabel?: string;
  disableDeviceFallback?: boolean;
}

const authCalls: AuthCallArgs[] = [];
let nextAuthPromise: Promise<{ success: boolean }> | null = null;

await mock.module('expo-local-authentication', () => ({
  hasHardwareAsync: () => Promise.resolve(true),
  isEnrolledAsync: () => Promise.resolve(true),
  authenticateAsync: (opts: AuthCallArgs) => {
    authCalls.push(opts);
    return nextAuthPromise ?? Promise.resolve({ success: true });
  },
}));

const bio = await import('../../src/keychain/biometric');

beforeEach(() => {
  authCalls.length = 0;
  nextAuthPromise = null;
  bio.resetBiometricGrace();
});

describe('requireBiometric sign prompt coalescing', () => {
  it('coalesces concurrent sign prompts before grace has been set', async () => {
    let resolveAuth!: (value: { success: boolean }) => void;
    nextAuthPromise = new Promise((resolve) => {
      resolveAuth = resolve;
    });

    const first = bio.requireBiometric('sign');
    const second = bio.requireBiometric('sign');
    await Promise.resolve();

    expect(authCalls.length).toBe(1);
    resolveAuth({ success: true });
    nextAuthPromise = null;

    expect(await Promise.all([first, second])).toEqual([true, true]);
  });
});
