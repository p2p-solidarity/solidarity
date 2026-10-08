import { describe, expect, test } from 'bun:test';

import { runOptionalPasskeySetup } from '../../src/onboarding/steps/optionalPasskeySetup';

describe('optional Passkey setup', () => {
  test('prepares the local identity but never opens Passkey when skipped', async () => {
    const events: string[] = [];

    expect(
      await runOptionalPasskeySetup('skip', {
        prepareLocalIdentity: async () => {
          events.push('prepare');
        },
        connectWeb: async () => {
          events.push('passkey');
          return { ok: true, value: 'binding' };
        },
      }),
    ).toEqual({ kind: 'skipped' });
    expect(events).toEqual(['prepare']);
  });

  test('connects only after the local identity is ready', async () => {
    const events: string[] = [];

    expect(
      await runOptionalPasskeySetup('connect', {
        prepareLocalIdentity: async () => {
          events.push('prepare');
        },
        connectWeb: async () => {
          events.push('passkey');
          return { ok: true, value: 'binding' };
        },
      }),
    ).toEqual({ kind: 'connected', binding: 'binding' });
    expect(events).toEqual(['prepare', 'passkey']);
  });

  test('never advances to Passkey when local identity setup fails', async () => {
    let passkeyCalled = false;

    await expect(
      runOptionalPasskeySetup('connect', {
        prepareLocalIdentity: () => Promise.reject(new Error('backup failed')),
        connectWeb: async () => {
          passkeyCalled = true;
          return { ok: true, value: 'binding' };
        },
      }),
    ).rejects.toThrow('backup failed');
    expect(passkeyCalled).toBe(false);
  });
});
