import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  WIPE_SECRET_TARGETS,
  WIPE_TARGETS,
  wipeEverything,
  type WipeEverythingDependencies,
} from '../../src/settings/wipeEverything';

function dependencies(
  calls: string[],
  failingTarget?: (typeof WIPE_TARGETS)[number],
): WipeEverythingDependencies {
  return Object.fromEntries(
    WIPE_TARGETS.map((target) => [
      target,
      async () => {
        calls.push(target);
        return target === failingTarget
          ? { ok: false as const, error: { kind: 'storageFailed' as const } }
          : { ok: true as const, value: undefined };
      },
    ]),
  ) as unknown as WipeEverythingDependencies;
}

describe('wipeEverything', () => {
  it('clears app data, deletes secrets, rotates storage, then resets preferences', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(dependencies(calls));

    expect(result).toEqual({ kind: 'ok' });
    expect(calls.slice(0, 2)).toEqual(['quiesce', 'appData']);
    expect(new Set(calls.slice(2, 2 + WIPE_SECRET_TARGETS.length))).toEqual(
      new Set(WIPE_SECRET_TARGETS),
    );
    expect(calls.slice(-4)).toEqual([
      'finalPersistentData',
      'masterEncryptionKey',
      'freshEncryptionKey',
      'preferences',
    ]);
  });

  it('attempts every identity-secret deletion but does not rotate storage after one fails', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(
      dependencies(calls, 'nostrKey'),
    );

    expect(calls).toContain('appData');
    expect(new Set(calls.slice(2))).toEqual(new Set(WIPE_SECRET_TARGETS));
    expect(calls).not.toContain('masterEncryptionKey');
    expect(calls).not.toContain('finalPersistentData');
    expect(calls).not.toContain('freshEncryptionKey');
    expect(calls).not.toContain('preferences');
    expect(result).toEqual({
      kind: 'incomplete',
      failedTargets: ['nostrKey'],
    });
    expect(JSON.stringify(result)).not.toContain('storageFailed');
  });

  it('fails closed when a dependency unexpectedly throws', async () => {
    const calls: string[] = [];
    const deps = dependencies(calls);

    const result = await wipeEverything({
      ...deps,
      signingKey: () => {
        throw new Error('private failure detail');
      },
    });

    expect(result).toEqual({
      kind: 'incomplete',
      failedTargets: ['signingKey'],
    });
    expect(JSON.stringify(result)).not.toContain('private failure detail');
  });

  it('keeps every key intact when clearing app data fails', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(dependencies(calls, 'appData'));

    expect(calls).toEqual(['quiesce', 'appData']);
    expect(result).toEqual({ kind: 'incomplete', failedTargets: ['appData'] });
  });

  it('does not touch app data when background work cannot be quiesced', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(dependencies(calls, 'quiesce'));

    expect(calls).toEqual(['quiesce']);
    expect(result).toEqual({
      kind: 'incomplete',
      failedTargets: ['quiesce'],
    });
  });

  it('does not write defaults until the blank store has a fresh encryption key', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(
      dependencies(calls, 'freshEncryptionKey'),
    );

    expect(calls.slice(-2)).toEqual([
      'masterEncryptionKey',
      'freshEncryptionKey',
    ]);
    expect(calls).not.toContain('preferences');
    expect(result).toEqual({
      kind: 'incomplete',
      failedTargets: ['freshEncryptionKey'],
    });
  });

  it('scrubs markers written by secret deletion before deleting the master key', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(
      dependencies(calls, 'finalPersistentData'),
    );

    expect(calls.slice(-2)).toEqual([
      'atprotoSession',
      'finalPersistentData',
    ]);
    expect(calls).not.toContain('masterEncryptionKey');
    expect(calls).not.toContain('freshEncryptionKey');
    expect(result).toEqual({
      kind: 'incomplete',
      failedTargets: ['finalPersistentData'],
    });
  });

  it('wires every target to a production deletion path without test resets', () => {
    const production = readFileSync(
      new URL('../../src/settings/productionWipe.ts', import.meta.url),
      'utf8',
    );
    const developer = readFileSync(
      new URL('../../app/settings/developer.tsx', import.meta.url),
      'utf8',
    );
    const rootLayout = readFileSync(
      new URL('../../app/_layout.tsx', import.meta.url),
      'utf8',
    );

    for (const operation of [
      'clearProductionAppData',
      'deleteProductionFiles',
      'deleteCacheDatabaseForLocalWipe',
      'deleteVaultDirectory',
      'deleteSigningKey',
      'deletePairwiseSeed',
      'deleteRootKeyForLocalWipe',
      'deleteMasterKey',
      'deleteRootSecret',
      'deleteRecipientKeys',
      'deleteIdentity',
      'deleteNostrKey',
      'signOutAtproto',
      'rekeyEmptyMmkv',
      'beginLocalDataWipe',
      'quiesceRecipientKeyOperations',
      'quiesceNostrKeyOperations',
      'quiesceRootKeyOperations',
      'quiesceSigningKeyOperations',
      'quiescePairwiseSeedOperations',
      'quiesceRootSecretOperations',
      'quiesceLocalDataOperations',
      'stopForegroundPolling',
      'stopLaneManager',
      'unregister',
    ]) {
      expect(production).toContain(operation);
    }
    for (const store of [
      'useCardStore',
      'useContactStore',
      'useRecentUpdatesStore',
      'useLeaveCardStore',
      'useCredentialStore',
      'useIssuerMetadataStore',
      'useGroupStore',
      'useVaultStore',
      'useShoutoutStore',
      'useProfileStore',
      'useProfileSnapshotStore',
      'useIdentityData',
      'useIdentityCoordinator',
      'useIssuerTrustAnchorStore',
      'useSharingSettings',
      'useZkIdentity',
      'usePageDesignStore',
    ]) {
      expect(production).toContain(
        `${store}.getState().resetForLocalWipe()`,
      );
    }
    for (const transientReset of [
      'useReceivedCard.getState().dismiss()',
      'useVerifiedPageResult.getState().dismiss()',
      'useWebSignPending.getState().clear()',
      'useSealedRouteStore.getState().clear()',
      'invalidateCachedNostrResult()',
      'invalidateCachedAtprotoResult()',
    ]) {
      expect(production).toContain(transientReset);
    }
    expect(production).toContain('resetPreferences');
    expect(production).toContain('getAllKeys().length === 0');
    expect(production).toContain('await preparePageDesign()');
    expect(rootLayout).toContain('hasCompletedOnboarding');
    expect(rootLayout).toContain(
      'if (!ready || !hasCompletedOnboarding || !remoteNotificationsEnabled)',
    );
    expect(developer).toContain('wipeLocalDevice()');
    expect(developer).toContain("router.replace('/onboarding')");
    expect(developer).not.toContain('resetSigningKeyForTesting');
    expect(developer).not.toContain('ensureSigningKey');
    expect(production).not.toContain('ForTesting');
  });
});
