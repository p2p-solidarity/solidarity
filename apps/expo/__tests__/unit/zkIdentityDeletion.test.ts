import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { Semaphore } from '@solidarity/nitro-attest';

import { deleteIdentityForLocalWipe } from '../../src/zk/identity';
import {
  __setSemaphoreNativeForTesting,
  __setSemaphoreNativeUnavailableForTesting,
} from '../../src/zk/nativeBridge';

afterEach(() => {
  __setSemaphoreNativeUnavailableForTesting(false);
  __setSemaphoreNativeForTesting(null);
});

describe('deleteIdentityForLocalWipe', () => {
  it('fails closed when the native identity module cannot be loaded', async () => {
    __setSemaphoreNativeUnavailableForTesting(true);

    expect(await deleteIdentityForLocalWipe()).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
  });

  it('maps a native deletion rejection to a redacted typed failure', async () => {
    __setSemaphoreNativeForTesting({
      deleteIdentity: () => Promise.reject(new Error('private native detail')),
    } as unknown as Semaphore);

    const result = await deleteIdentityForLocalWipe();

    expect(result).toEqual({
      ok: false,
      error: { kind: 'storageFailed' },
    });
    expect(JSON.stringify(result)).not.toContain('private native detail');
  });

  it('requires strict idempotent native deletion contracts on both platforms', () => {
    const ios = readFileSync(
      new URL('../../../../nitro-modules/attest/ios/HybridSemaphore.swift', import.meta.url),
      'utf8',
    );
    const android = readFileSync(
      new URL(
        '../../../../nitro-modules/attest/android/src/main/java/com/margelo/nitro/gg/solidarity/attest/HybridSemaphore.kt',
        import.meta.url,
      ),
      'utf8',
    );

    expect(ios).toContain('errSecItemNotFound');
    expect(ios).toContain('keychainDeleteFailed');
    expect(ios).toContain(
      'try Self.deleteKeychain(alias: Self.nullifierStoreAlias)',
    );
    expect(android).toContain('.commit()');
    expect(android).toContain('Failed to delete Semaphore identity');
    expect(android).toContain('.remove(NULLIFIER_STORE_KEY)');
  });
});
