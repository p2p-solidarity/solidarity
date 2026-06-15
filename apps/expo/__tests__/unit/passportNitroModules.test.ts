import { describe, expect, it } from 'bun:test';

import {
  loadPassportNitroModules,
  type PassportNitroModules,
} from '../../src/passport/nitroModules';

describe('loadPassportNitroModules', () => {
  it('keeps the NFC reader when the passport ZK module is unavailable', () => {
    const nfc = {
      isAvailable: () => true,
    } as NonNullable<PassportNitroModules['nfc']>;
    const modules = loadPassportNitroModules({
      getNfcPassport: () => nfc,
      getPassportZk: () => {
        throw new Error('zk module missing');
      },
    });

    expect(modules.nfc).toBe(nfc);
    expect(modules.zk).toBeNull();
  });

  it('keeps the passport ZK prover when the NFC reader is unavailable', () => {
    const zk = {
      generateNoirProof: () => Promise.resolve({}),
      verifyNoirProof: () => Promise.resolve(true),
    } as unknown as NonNullable<PassportNitroModules['zk']>;
    const modules = loadPassportNitroModules({
      getNfcPassport: () => {
        throw new Error('nfc module missing');
      },
      getPassportZk: () => zk,
    });

    expect(modules.nfc).toBeNull();
    expect(modules.zk).toBe(zk);
  });
});
