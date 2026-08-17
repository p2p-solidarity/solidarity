/**
 * Local wipe coordinator.
 *
 * Every operation is attempted even when another one fails. The result only
 * names the storage domain that needs attention; underlying errors can carry
 * secret material and must never cross into UI copy or logs.
 */
export const WIPE_SECRET_TARGETS = [
  'signingKey',
  'pairwiseSeed',
  'rootKey',
  'vaultRootSecret',
  'recipientKeys',
  'zkIdentity',
  'nostrKey',
  'atprotoSession',
] as const;

export const WIPE_TARGETS = [
  'quiesce',
  'appData',
  ...WIPE_SECRET_TARGETS,
  'finalPersistentData',
  'masterEncryptionKey',
  'freshEncryptionKey',
  'preferences',
] as const;

export type WipeTarget = (typeof WIPE_TARGETS)[number];

export type WipeOperationResult =
  | { readonly ok: true }
  | { readonly ok: false };

export type WipeEverythingDependencies = Readonly<
  Record<
    WipeTarget,
    () => WipeOperationResult | Promise<WipeOperationResult>
  >
>;

export type WipeEverythingResult =
  | { readonly kind: 'ok' }
  | {
      readonly kind: 'incomplete';
      readonly failedTargets: readonly WipeTarget[];
    };

export async function wipeEverything(
  dependencies: WipeEverythingDependencies,
): Promise<WipeEverythingResult> {
  const runTarget = async (target: WipeTarget): Promise<boolean> => {
    try {
      const result = await dependencies[target]();
      return result.ok;
    } catch {
      return false;
    }
  };

  // Do not orphan encrypted records behind a deleted key. The data store has
  // to be empty before any identity/key deletion starts.
  if (!(await runTarget('quiesce'))) {
    return { kind: 'incomplete', failedTargets: ['quiesce'] };
  }

  if (!(await runTarget('appData'))) {
    return { kind: 'incomplete', failedTargets: ['appData'] };
  }

  // Independent identity stores are all attempted so one unavailable native
  // module does not leave every other secret behind. Keep the MMKV master key
  // until this phase has succeeded so an incomplete wipe is safely retryable.
  const secretSettled = await Promise.all(
    WIPE_SECRET_TARGETS.map(async (target) => ({
      target,
      ok: await runTarget(target),
    })),
  );
  const failedSecrets = secretSettled
    .filter((result) => !result.ok)
    .map((result) => result.target);
  if (failedSecrets.length > 0) {
    return { kind: 'incomplete', failedTargets: failedSecrets };
  }

  // Some secret stores keep an MMKV presence mirror (for example Nostr).
  // Their production deletion APIs may write an explicit `false` after the
  // first app-data clear. Scrub those markers before deleting the master key,
  // or rekeyEmptyMmkv would correctly reject the non-empty live store.
  if (!(await runTarget('finalPersistentData'))) {
    return { kind: 'incomplete', failedTargets: ['finalPersistentData'] };
  }

  if (!(await runTarget('masterEncryptionKey'))) {
    return {
      kind: 'incomplete',
      failedTargets: ['masterEncryptionKey'],
    };
  }

  // The process stays alive after a successful wipe. Immediately provision a
  // blank-store key and rekey the live MMKV instance before any default value
  // is written; otherwise those defaults would still use the deleted key.
  if (!(await runTarget('freshEncryptionKey'))) {
    return { kind: 'incomplete', failedTargets: ['freshEncryptionKey'] };
  }

  if (!(await runTarget('preferences'))) {
    return { kind: 'incomplete', failedTargets: ['preferences'] };
  }

  return { kind: 'ok' };
}
