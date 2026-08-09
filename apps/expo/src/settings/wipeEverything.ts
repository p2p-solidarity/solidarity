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
  'appData',
  ...WIPE_SECRET_TARGETS,
  'masterEncryptionKey',
  'freshEncryptionKey',
  'preferences',
] as const;

export type WipeTarget = (typeof WIPE_TARGETS)[number];

export type WipeEverythingDependencies = Readonly<
  Record<WipeTarget, () => void | Promise<void>>
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
      await dependencies[target]();
      return true;
    } catch {
      return false;
    }
  };

  // Do not orphan encrypted records behind a deleted key. The data store has
  // to be empty before any identity/key deletion starts.
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
