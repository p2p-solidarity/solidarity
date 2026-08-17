/**
 * T7 wait-for-sync policy (`secureKeysStepLogic.ts`) — pure DI-fake tests,
 * no React and no keystore. Pins the bounded-wait contract SecureKeysStep
 * relies on: found exits early, timeout is bounded, abort wins, and the
 * probe can never be minting (that property lives in signingKey.ts's
 * `hasExistingSigningKey`, asserted in spruceDid.parity.test.ts).
 */
import { describe, expect, it } from 'bun:test';

import { waitForSyncedSigningKey } from '../../src/onboarding/steps/secureKeysStepLogic';

function makeSleeper(): { readonly sleep: (ms: number) => Promise<void>; readonly slept: number[] } {
  const slept: number[] = [];
  return {
    slept,
    sleep: (ms: number) => {
      slept.push(ms);
      return Promise.resolve();
    },
  };
}

describe('waitForSyncedSigningKey', () => {
  it('returns found as soon as the probe sees the key — no further sleeps', async () => {
    const { sleep, slept } = makeSleeper();
    let calls = 0;
    const outcome = await waitForSyncedSigningKey({
      attempts: 6,
      intervalMs: 2500,
      probe: () => {
        calls += 1;
        return Promise.resolve(calls === 3);
      },
      sleep,
    });

    expect(outcome).toBe('found');
    expect(calls).toBe(3);
    expect(slept).toEqual([2500, 2500]);
  });

  it('times out after exactly `attempts` probes with sleeps only BETWEEN them', async () => {
    const { sleep, slept } = makeSleeper();
    let calls = 0;
    const outcome = await waitForSyncedSigningKey({
      attempts: 4,
      intervalMs: 1000,
      probe: () => {
        calls += 1;
        return Promise.resolve(false);
      },
      sleep,
    });

    expect(outcome).toBe('timeout');
    expect(calls).toBe(4);
    // No trailing sleep after the final probe — the user is not kept waiting
    // one extra interval for nothing.
    expect(slept).toEqual([1000, 1000, 1000]);
  });

  it('aborts without probing when shouldContinue is already false', async () => {
    const { sleep } = makeSleeper();
    let calls = 0;
    const outcome = await waitForSyncedSigningKey({
      attempts: 3,
      intervalMs: 500,
      probe: () => {
        calls += 1;
        return Promise.resolve(false);
      },
      sleep,
      shouldContinue: () => false,
    });

    expect(outcome).toBe('aborted');
    expect(calls).toBe(0);
  });

  it('abort between probes wins over timeout', async () => {
    const { sleep } = makeSleeper();
    let calls = 0;
    const outcome = await waitForSyncedSigningKey({
      attempts: 3,
      intervalMs: 500,
      probe: () => {
        calls += 1;
        return Promise.resolve(false);
      },
      sleep,
      shouldContinue: () => calls < 2,
    });

    expect(outcome).toBe('aborted');
    expect(calls).toBe(2);
  });
});
