import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from '@/storage/deletionResult';

export interface ProductionAppDataDependencies {
  readonly deleteFiles: () =>
    | LocalDeletionResult
    | Promise<LocalDeletionResult>;
  readonly clearPersistentData: () => void;
  readonly clearMemoryCaches: () => void;
}

/**
 * Clear durable app data before dropping any live plaintext references.
 * Files are first so a filesystem failure leaves MMKV and every key
 * available for a safe retry. Memory is cleared only after both durable
 * stores are empty, preventing a retained Zustand object from repopulating
 * the freshly-keyed store.
 */
export async function clearProductionAppData(
  dependencies: ProductionAppDataDependencies,
): Promise<LocalDeletionResult> {
  try {
    const files = await dependencies.deleteFiles();
    if (!files.ok) return deletionFailed();
    dependencies.clearPersistentData();
    dependencies.clearMemoryCaches();
    return deletionSucceeded();
  } catch {
    return deletionFailed();
  }
}
