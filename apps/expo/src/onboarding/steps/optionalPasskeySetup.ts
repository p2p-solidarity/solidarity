import type { Result } from '@solidarity/shared';

import type { RootVaultSyncError } from '@/identity/rootVaultSync';

export type OptionalPasskeyChoice = 'connect' | 'skip';

export type OptionalPasskeyOutcome =
  | { readonly kind: 'skipped' }
  | { readonly kind: 'connected'; readonly binding: string }
  | { readonly kind: 'failed'; readonly error: RootVaultSyncError };

export interface OptionalPasskeySetupDependencies {
  readonly prepareLocalIdentity: () => Promise<void>;
  readonly connectWeb: () => Promise<Result<string, RootVaultSyncError>>;
}

/** Local identity setup is mandatory; connecting it to Web is not. */
export async function runOptionalPasskeySetup(
  choice: OptionalPasskeyChoice,
  dependencies: OptionalPasskeySetupDependencies,
): Promise<OptionalPasskeyOutcome> {
  await dependencies.prepareLocalIdentity();
  if (choice === 'skip') return { kind: 'skipped' };

  const connected = await dependencies.connectWeb();
  return connected.ok
    ? { kind: 'connected', binding: connected.value }
    : { kind: 'failed', error: connected.error };
}
