import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

function repoSource(path: string): string {
  return readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
}

describe('native secure-storage deletion contracts', () => {
  it('makes signing-key deletion idempotent while surfacing unexpected Keychain/Keystore errors', () => {
    const ios = repoSource('nitro-modules/keystone/ios/SpruceDidKeyStore.swift');
    const android = repoSource(
      'nitro-modules/keystone/android/src/main/java/com/margelo/nitro/gg/solidarity/keystone/HybridSpruceDid.kt',
    );

    expect(ios).toContain('case errSecSuccess, errSecItemNotFound');
    expect(ios).toContain('throw SpruceDidError.keychainFailure');
    expect(android).not.toContain(
      'keyStore.deleteEntry(keystoreAlias(alias))\n      true\n    }.getOrDefault(false)',
    );
    expect(android).toContain(
      'if (keyStore.containsAlias(keystoreAlias(alias)))',
    );
  });

  it('does not swallow Android vault wrapping-key deletion failures', () => {
    const android = repoSource(
      'nitro-modules/keystone/android/src/main/java/com/margelo/nitro/gg/solidarity/keystone/HybridSecretsVault.kt',
    );

    expect(android).toContain('keyStore.deleteEntry(keystoreAlias(keyAlias))');
    expect(android).not.toContain(
      'runCatching { keyStore.deleteEntry(keystoreAlias(keyAlias)) }',
    );
    expect(android).toContain(
      'if (keyStore.containsAlias(keystoreAlias(keyAlias)))',
    );
    expect(android).toContain(
      'override fun deleteSynchronizableItem(alias: String): Promise<Unit> = Promise.async {\n    Unit',
    );
  });

  it('closes and removes the SQLite PII cache including WAL sidecars', () => {
    const cache = repoSource('apps/expo/src/storage/cache.ts');

    expect(cache).toContain('await opened.close()');
    expect(cache).toContain('SQLite.deleteDatabaseAsync(databaseName)');
    expect(cache).toContain('await dependencies.deleteDatabase(DB_NAME)');
    expect(cache).toContain("databaseSidecarUri(dependencies.databaseDirectory, '-wal')");
    expect(cache).toContain("databaseSidecarUri(dependencies.databaseDirectory, '-shm')");
    expect(cache).toContain("databaseSidecarUri(dependencies.databaseDirectory, '-journal')");
  });
});
