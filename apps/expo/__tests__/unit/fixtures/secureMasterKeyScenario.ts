import { mock } from 'bun:test';

import { base64Encode } from '@solidarity/shared';

const MASTER_KEY_ALIAS_V2 = 'gg.solidarity.master.v2';
const LEGACY_SERVICE = 'airmeishi';
const LEGACY_ACCOUNT = 'com.kidneyweakx.airmeishi.encryption.key';

const scenario = process.argv[2];
const legacyKey = Uint8Array.from({ length: 32 }, (_v, i) => (0x41 + i) & 0xff);
const wrongV2Key = Uint8Array.from({ length: 32 }, (_v, i) => (0xa0 + i) & 0xff);

const secureStore = new Map<string, string>();
const rawKeychainReads: { service: string; account: string }[] = [];
let releaseV2Write!: () => void;
let markV2WriteStarted: (() => void) | null = null;
const v2WriteStarted = new Promise<void>((resolve) => {
  markV2WriteStarted = resolve;
});
const v2WriteRelease = new Promise<void>((resolve) => {
  releaseV2Write = resolve;
});

function storeKey(alias: string, opts?: { keychainService?: string }): string {
  return `${opts?.keychainService ?? 'default'}:${alias}`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes);
  return copy.buffer;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

await mock.module('@solidarity/nitro-keystone', () => ({
  getSecretsVault: () => ({
    readRawKeychainGenericPassword: (
      service: string,
      account: string
    ): Promise<ArrayBuffer> => {
      rawKeychainReads.push({ service, account });
      if (
        scenario !== 'pending-delete' &&
        service === LEGACY_SERVICE &&
        account === LEGACY_ACCOUNT
      ) {
        return Promise.resolve(toArrayBuffer(legacyKey));
      }
      return Promise.resolve(new ArrayBuffer(0));
    },
  }),
}));

await mock.module('expo-secure-store', () => ({
  WHEN_UNLOCKED: 'whenUnlocked',
  getItemAsync: (
    alias: string,
    opts?: { keychainService?: string }
  ): Promise<string | null> =>
    Promise.resolve(secureStore.get(storeKey(alias, opts)) ?? null),
  setItemAsync: async (
    alias: string,
    value: string,
    opts?: { keychainService?: string }
  ): Promise<void> => {
    if (scenario === 'pending-delete' && alias === MASTER_KEY_ALIAS_V2) {
      markV2WriteStarted?.();
      await v2WriteRelease;
    }
    secureStore.set(storeKey(alias, opts), value);
  },
  deleteItemAsync: (
    alias: string,
    opts?: { keychainService?: string }
  ): Promise<void> => {
    secureStore.delete(storeKey(alias, opts));
    return Promise.resolve();
  },
}));

const mod = await import('../../../src/storage/secureMasterKey');
await mod.resetMasterKeyForTesting();

if (scenario === 'pending-delete') {
  const acquisition = mod.getMasterKey();
  await v2WriteStarted;
  const deletion = mod.deleteMasterKey();
  let acquisitionWasBlocked = false;
  try {
    await mod.getMasterKey();
  } catch {
    acquisitionWasBlocked = true;
  }
  releaseV2Write();
  await acquisition;
  const deletionResult = await deletion;
  assert(acquisitionWasBlocked, 'new acquisition was allowed during deletion');
  assert(deletionResult.ok, 'master key deletion did not complete');
  assert(
    !secureStore.has(`default:${MASTER_KEY_ALIAS_V2}`),
    'in-flight acquisition rewrote the master key after deletion',
  );
} else if (scenario === 'repair-bad-v2') {
  secureStore.set(`default:${MASTER_KEY_ALIAS_V2}`, base64Encode(wrongV2Key));
} else if (scenario !== 'fresh-legacy') {
  throw new Error(`unknown scenario: ${String(scenario)}`);
}

if (scenario !== 'pending-delete') {
  const key = await mod.getMasterKey();

  assert(sameBytes(key, legacyKey), 'getMasterKey did not return the legacy key');
  assert(
    secureStore.get(`default:${MASTER_KEY_ALIAS_V2}`) === base64Encode(legacyKey),
    'v2 key was not written with the recovered legacy key'
  );
  assert(
    rawKeychainReads.some(
      (read) => read.service === LEGACY_SERVICE && read.account === LEGACY_ACCOUNT
    ),
    'legacy Keychain coordinates were not queried'
  );
}

const result = `secureMasterKey:${scenario}:ok`;
const resultPath = process.env['SECURE_MASTER_KEY_RESULT_PATH'];
if (resultPath) {
  await Bun.write(resultPath, result);
}
console.log(result);
