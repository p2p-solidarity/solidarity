/**
 * Presentation-sheet prefetch (spec §3 “Show fast path”, phase-2 slice:
 * witness decrypt + nitro lazy-load only; warmupCircuit lands in phase 3).
 *
 * The witness bundle is immutable per credential, so the sheet can start
 * the MMKV decrypt while the user is still picking claims. The cache holds
 * the in-flight promise — same secret-exposure window as the prove path
 * itself. Cleared when the sheet closes and when the credential is deleted.
 *
 * Default loaders resolve lazily via require() (same pattern as
 * nitroModules.ts) so importing this module never drags react-native into
 * non-RN runtimes (bun tests inject their own loaders).
 */
const witnessPrefetch = new Map<string, Promise<string | null>>();

function defaultLoadWitness(credentialId: string): Promise<string | null> {
  const vault =
    require('@/passport/showWitnessVault') as typeof import('@/passport/showWitnessVault');
  return vault.loadPassportShowWitness(credentialId);
}

function defaultLoadModules(): unknown {
  const mod =
    require('@/passport/nitroModules') as typeof import('@/passport/nitroModules');
  return mod.loadPassportNitroModules();
}

export function prefetchPassportShowPresentation(
  credentialId: string,
  loadWitness: (id: string) => Promise<string | null> = defaultLoadWitness,
  loadModules: () => unknown = defaultLoadModules
): void {
  if (!witnessPrefetch.has(credentialId)) {
    witnessPrefetch.set(
      credentialId,
      loadWitness(credentialId).catch(() => null)
    );
  }
  // Nitro lazy-load is internally idempotent; a failure here surfaces as
  // the real error on the prove path, never silently here.
  try {
    loadModules();
  } catch {
    // prove path reports 'ZK prover is not linked on this build.'
  }
}

/** Promise from a prior prefetch, or null when none is cached. */
export function consumePrefetchedPassportShowWitness(
  credentialId: string
): Promise<string | null> | null {
  return witnessPrefetch.get(credentialId) ?? null;
}

export function clearPassportShowPrefetch(credentialId?: string): void {
  if (credentialId === undefined) witnessPrefetch.clear();
  else witnessPrefetch.delete(credentialId);
}
