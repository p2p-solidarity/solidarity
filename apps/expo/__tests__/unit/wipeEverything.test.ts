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
        if (target === failingTarget) throw new Error('private failure detail');
      },
    ]),
  ) as unknown as WipeEverythingDependencies;
}

describe('wipeEverything', () => {
  it('clears app data, deletes secrets, rotates storage, then resets preferences', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(dependencies(calls));

    expect(result).toEqual({ kind: 'ok' });
    expect(calls[0]).toBe('appData');
    expect(new Set(calls.slice(1, 1 + WIPE_SECRET_TARGETS.length))).toEqual(
      new Set(WIPE_SECRET_TARGETS),
    );
    expect(calls.slice(-3)).toEqual([
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
    expect(new Set(calls.slice(1))).toEqual(new Set(WIPE_SECRET_TARGETS));
    expect(calls).not.toContain('masterEncryptionKey');
    expect(calls).not.toContain('freshEncryptionKey');
    expect(calls).not.toContain('preferences');
    expect(result).toEqual({
      kind: 'incomplete',
      failedTargets: ['nostrKey'],
    });
    expect(JSON.stringify(result)).not.toContain('private failure detail');
  });

  it('keeps every key intact when clearing app data fails', async () => {
    const calls: string[] = [];

    const result = await wipeEverything(dependencies(calls, 'appData'));

    expect(calls).toEqual(['appData']);
    expect(result).toEqual({ kind: 'incomplete', failedTargets: ['appData'] });
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

  it('wires every target to a production deletion path without test resets', () => {
    const production = readFileSync(
      new URL('../../src/settings/productionWipe.ts', import.meta.url),
      'utf8',
    );
    const developer = readFileSync(
      new URL('../../app/settings/developer.tsx', import.meta.url),
      'utf8',
    );

    for (const operation of [
      'clearAllData',
      'deleteSigningKey',
      'deletePairwiseSeed',
      'deleteRootKey',
      'deleteMasterKey',
      'deleteRootSecret',
      'deleteRecipientKeys',
      'deleteIdentity',
      'deleteNostrKey',
      'signOutAtproto',
      'rekeyEmptyMmkv',
    ]) {
      expect(production).toContain(operation);
    }
    expect(production).toContain('resetPreferences');
    expect(developer).toContain('wipeLocalDevice()');
    expect(developer).toContain("router.replace('/onboarding')");
    expect(developer).not.toContain('resetSigningKeyForTesting');
    expect(developer).not.toContain('ensureSigningKey');
  });
});
