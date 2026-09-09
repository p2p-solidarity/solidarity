import type { getNfcPassport as getNfcPassportFn } from '@solidarity/nitro-attest';
import type { getPassportZk as getPassportZkFn } from '@solidarity/nitro-attest';

type GetNfcPassport = typeof getNfcPassportFn;
type GetPassportZk = typeof getPassportZkFn;

export interface PassportNitroModuleFactories {
  readonly getNfcPassport: () => ReturnType<GetNfcPassport>;
  readonly getPassportZk: () => ReturnType<GetPassportZk>;
}

export interface PassportNitroModules {
  readonly nfc: ReturnType<GetNfcPassport> | null;
  readonly zk: ReturnType<GetPassportZk> | null;
}

const DEFAULT_FACTORIES: PassportNitroModuleFactories = {
  getNfcPassport: () => {
    const mod = require('@solidarity/nitro-attest') as {
      readonly getNfcPassport: GetNfcPassport;
    };
    return mod.getNfcPassport();
  },
  getPassportZk: () => {
    const mod = require('@solidarity/nitro-attest') as {
      readonly getPassportZk: GetPassportZk;
    };
    return mod.getPassportZk();
  },
};

export function loadPassportNitroModules(
  factories: PassportNitroModuleFactories = DEFAULT_FACTORIES
): PassportNitroModules {
  return {
    nfc: loadOrNull(factories.getNfcPassport),
    zk: loadOrNull(factories.getPassportZk),
  };
}

function loadOrNull<T>(load: () => T): T | null {
  try {
    return load();
  } catch {
    return null;
  }
}
