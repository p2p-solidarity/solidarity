import { afterEach, describe, expect, it } from 'bun:test';

import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  captureLocalDataEpoch,
  completeLocalDataWipe,
  canCommitLocalData,
  quiesceLocalDataOperations,
  trackLocalDataOperation,
} from '../../src/settings/localDataWipeBarrier';

afterEach(() => {
  __resetLocalDataWipeBarrierForTesting();
});

describe('localDataWipeBarrier', () => {
  it('rejects both current and stale writes while a wipe is active', () => {
    const beforeWipe = captureLocalDataEpoch();

    beginLocalDataWipe();

    expect(canCommitLocalData(beforeWipe)).toBe(false);
    expect(canCommitLocalData(captureLocalDataEpoch())).toBe(false);
  });

  it('allows new writes after completion but permanently rejects pre-wipe epochs', () => {
    const stale = captureLocalDataEpoch();
    beginLocalDataWipe();
    completeLocalDataWipe();

    expect(canCommitLocalData(stale)).toBe(false);
    expect(canCommitLocalData(captureLocalDataEpoch())).toBe(true);
  });

  it('drains a registered writer before durable files are deleted', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    trackLocalDataOperation(pending);

    beginLocalDataWipe();
    let quiesced = false;
    const quiesce = quiesceLocalDataOperations().then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);

    release();
    await quiesce;
    expect(quiesced).toBe(true);
  });
});
