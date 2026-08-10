import { beforeEach, describe, expect, it, mock } from 'bun:test';

const deleteCalls: Array<{
  readonly path: string;
  readonly options: { readonly idempotent: boolean };
}> = [];
let vaultDirectoryExists = true;
let deleteShouldFail = false;

void mock.module('expo-file-system/legacy', () => ({
  documentDirectory: '/documents/',
  EncodingType: { Base64: 'base64' },
  getInfoAsync: (): Promise<{ exists: boolean }> =>
    Promise.resolve({ exists: vaultDirectoryExists }),
  deleteAsync: (
    path: string,
    options: { readonly idempotent: boolean },
  ): Promise<void> => {
    deleteCalls.push({ path, options });
    return deleteShouldFail
      ? Promise.reject(new Error('private filesystem detail'))
      : Promise.resolve();
  },
}));

void mock.module('@/storage/secureMasterKey', () => ({
  getMasterKey: (): Promise<Uint8Array> => Promise.resolve(new Uint8Array(32)),
}));

const { deleteVaultDirectory } = await import('../../src/vault/storage');

beforeEach(() => {
  deleteCalls.length = 0;
  vaultDirectoryExists = true;
  deleteShouldFail = false;
});

describe('deleteVaultDirectory', () => {
  it('strictly deletes only the app vault directory', async () => {
    const result = await deleteVaultDirectory();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(deleteCalls).toEqual([
      {
        path: '/documents/vault/',
        options: { idempotent: true },
      },
    ]);
  });

  it('treats an absent vault directory as already deleted', async () => {
    vaultDirectoryExists = false;

    const result = await deleteVaultDirectory();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(deleteCalls).toEqual([]);
  });

  it('returns a typed failure without exposing filesystem details', async () => {
    deleteShouldFail = true;

    const result = await deleteVaultDirectory();

    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(JSON.stringify(result)).not.toContain('private filesystem detail');
  });
});
