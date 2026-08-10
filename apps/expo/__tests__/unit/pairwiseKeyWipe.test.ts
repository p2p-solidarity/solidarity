import { afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import {
  __resetLocalDataWipeBarrierForTesting,
  beginLocalDataWipe,
  completeLocalDataWipe,
} from '../../src/settings/localDataWipeBarrier';

const PAIRWISE_SEED_ALIAS = 'solidarity.pairwise.seed.v2';

const secureStore = new Map<string, string>();
let seedWriteGate: Promise<void> | null = null;
let seedWriteStarted: (() => void) | null = null;

void mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: (alias: string): Promise<string | null> =>
    Promise.resolve(secureStore.get(alias) ?? null),
  setItemAsync: (alias: string, value: string): Promise<void> => {
    if (alias === PAIRWISE_SEED_ALIAS) {
      seedWriteStarted?.();
      return (seedWriteGate ?? Promise.resolve()).then(() => {
        secureStore.set(alias, value);
      });
    }
    secureStore.set(alias, value);
    return Promise.resolve();
  },
  deleteItemAsync: (alias: string): Promise<void> => {
    secureStore.delete(alias);
    return Promise.resolve();
  },
}));

interface PairwiseKeyMod {
  readonly pairwisePrivateKey: (domain: string) => Promise<Uint8Array>;
  readonly quiescePairwiseSeedOperations: () => Promise<void>;
  readonly resetPairwiseSeedForTesting: () => Promise<void>;
}

let mod: PairwiseKeyMod;

beforeAll(async () => {
  mod = (await import('../../src/keychain/pairwiseKey')) as PairwiseKeyMod;
});

beforeEach(async () => {
  secureStore.clear();
  seedWriteGate = null;
  seedWriteStarted = null;
  __resetLocalDataWipeBarrierForTesting();
  await mod.resetPairwiseSeedForTesting();
});

afterEach(async () => {
  __resetLocalDataWipeBarrierForTesting();
  await mod.resetPairwiseSeedForTesting();
});

describe('pairwise seed local-wipe barrier', () => {
  it('removes a seed whose SecureStore write completes after the wipe began', async () => {
    let markWriteStarted!: () => void;
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    let releaseWrite!: () => void;
    seedWriteGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    seedWriteStarted = markWriteStarted;

    const provisioning = mod.pairwisePrivateKey('verifier.example');
    await writeStarted;
    beginLocalDataWipe();

    let quiesced = false;
    const quiesce = mod.quiescePairwiseSeedOperations().then(() => {
      quiesced = true;
    });
    await Promise.resolve();
    expect(quiesced).toBe(false);

    releaseWrite();
    await expect(provisioning).rejects.toThrow(/local data wipe/i);
    await quiesce;

    expect(secureStore.has(PAIRWISE_SEED_ALIAS)).toBe(false);
    completeLocalDataWipe();
  });
});
