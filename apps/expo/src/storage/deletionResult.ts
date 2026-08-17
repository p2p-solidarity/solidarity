import { err, ok, type Result } from '@solidarity/shared';

/**
 * Deliberately coarse: native/keychain failures can contain secret material.
 * Callers only need to know that local deletion was incomplete and must not
 * rotate the remaining encryption keys or report success.
 */
export interface LocalDeletionError {
  readonly kind: 'storageFailed';
}
export type LocalDeletionResult = Result<void, LocalDeletionError>;

export function deletionSucceeded(): LocalDeletionResult {
  return ok(undefined);
}

export function deletionFailed(): LocalDeletionResult {
  return err({ kind: 'storageFailed' });
}
