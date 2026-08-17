import {
  deletionFailed,
  deletionSucceeded,
  type LocalDeletionResult,
} from '@/storage/deletionResult';

const DOCUMENT_ARTIFACTS = [
  'profile-avatar/',
  'images/',
  'wallet/',
] as const;

const CACHE_ARTIFACTS = [
  'wallet/',
  'solidarity_vcs.json',
  'solidarity-contacts.vcf',
  'solidarity-qr.png',
] as const;

export interface ProductionFilesDependencies {
  readonly documentDirectory: string | null;
  readonly cacheDirectory: string | null;
  readonly deletePath: (path: string) => Promise<void>;
  readonly deleteVaultFiles: () =>
    | LocalDeletionResult
    | Promise<LocalDeletionResult>;
  readonly deleteCacheDatabase: () =>
    | LocalDeletionResult
    | Promise<LocalDeletionResult>;
}

/**
 * Delete every app-owned file that may contain identity or contact data.
 * Paths are deliberately enumerated; this never recursively removes a broad
 * OS cache/document root. Independent operations are all attempted so one
 * bad artifact does not prevent the others from being scrubbed.
 */
export async function deleteProductionFiles(
  dependencies: ProductionFilesDependencies,
): Promise<LocalDeletionResult> {
  const { cacheDirectory, documentDirectory } = dependencies;
  if (!documentDirectory || !cacheDirectory) return deletionFailed();

  const paths = [
    ...DOCUMENT_ARTIFACTS.map((suffix) => `${documentDirectory}${suffix}`),
    ...CACHE_ARTIFACTS.map((suffix) => `${cacheDirectory}${suffix}`),
  ];
  const operations: Promise<boolean>[] = [
    ...paths.map(async (path) => {
      await dependencies.deletePath(path);
      return true;
    }),
    Promise.resolve(dependencies.deleteVaultFiles()).then((result) => result.ok),
    Promise.resolve(dependencies.deleteCacheDatabase()).then(
      (result) => result.ok,
    ),
  ];
  const results = await Promise.allSettled(operations);

  const failed = results.some(
    (result) => result.status === 'rejected' || !result.value,
  );
  return failed ? deletionFailed() : deletionSucceeded();
}
