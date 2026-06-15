/**
 * IdentityCoordinator — zustand store backing the React hooks that the
 * ID screens consume (`useIdentitySnapshot`, `useZkIdentityCommitment`,
 * `useIdentityState`).
 *
 * Mirrors Swift's `IdentityCoordinator.shared` selector slice — the
 * store is intentionally tiny because all the heavy state (private key,
 * commitment) lives in native land. We cache the public-facing
 * commitment + the "operation in progress" flag here so the renderer
 * doesn't have to await a JSI call on every paint.
 *
 * Hydration order:
 *   • `seedFromNative()` is called from `_layout.tsx` on app start; it
 *     does ONE bridge round-trip to populate the cached commitment.
 *   • All UI selectors return the in-memory cache, so the first paint
 *     is synchronous + the bridge stays off the critical path.
 */
import { create } from 'zustand';

import {
  currentIdentity,
  deleteIdentity as nativeDeleteIdentity,
  loadOrCreateIdentity,
} from './identity';

export interface ZkIdentityState {
  readonly commitment: string | null;
  readonly proofsSupported: boolean;
  readonly isWorking: boolean;
  readonly lastError: string | null;
  readonly hydrated: boolean;
  readonly seedFromNative: () => Promise<void>;
  readonly createIdentity: () => Promise<void>;
  readonly deleteIdentity: () => Promise<void>;
  readonly clearError: () => void;
}

export const useZkIdentity = create<ZkIdentityState>((set, get) => ({
  commitment: null,
  proofsSupported: false,
  isWorking: false,
  lastError: null,
  hydrated: false,

  seedFromNative: async () => {
    if (get().hydrated) return;
    try {
      const snap = await currentIdentity();
      set({
        commitment: snap.commitment,
        proofsSupported: snap.proofsSupported,
        hydrated: true,
      });
    } catch (error) {
      set({
        lastError: error instanceof Error ? error.message : String(error),
        hydrated: true,
      });
    }
  },

  createIdentity: async () => {
    if (get().isWorking) return;
    set({ isWorking: true, lastError: null });
    try {
      const snap = await loadOrCreateIdentity();
      set({
        commitment: snap.commitment,
        proofsSupported: snap.proofsSupported,
        isWorking: false,
        hydrated: true,
      });
    } catch (error) {
      set({
        isWorking: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  deleteIdentity: async () => {
    if (get().isWorking) return;
    set({ isWorking: true, lastError: null });
    try {
      await nativeDeleteIdentity();
      set({ commitment: null, isWorking: false });
    } catch (error) {
      set({
        isWorking: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },

  clearError: () => { set({ lastError: null }); },
}));

// ── Selectors / React hooks ─────────────────────────────────────────────

/**
 * Snapshot used by the top-level ID screen (app/id/index.tsx). The shape
 * matches the existing local stub so the screen keeps compiling.
 */
export interface IdentityHomeSnapshot {
  readonly did: string | null;
  readonly commitment: string | null;
}

export function useIdentitySnapshot(): IdentityHomeSnapshot {
  // `did` is null until the DID layer is wired (signingKey is what
  // generates did:key on the Expo side, but it's biometric-gated, so we
  // intentionally don't fetch it from here — the screen will lazy-load
  // it on demand). The commitment is the Semaphore identity, which IS
  // surfaced now.
  return useZkIdentity((s) => ({ did: null, commitment: s.commitment }));
}

/** Used by app/id/zk-settings.tsx for the Identity Status block. */
export function useZkIdentityCommitment(): string | null {
  return useZkIdentity((s) => s.commitment);
}

/** Used by app/id/zk-settings.tsx for the "Proofs Supported" row. */
export function useProofsSupported(): boolean {
  return useZkIdentity((s) => s.proofsSupported);
}

/** Used by app/id/personal.tsx. Returns the shape PersonalPanel expects. */
export function useIdentityState(): {
  readonly commitment: string | null;
  readonly activeDid: string | null;
  readonly jwkJson: string | null;
  readonly didDocumentJson: string | null;
  readonly serviceCount: number;
  readonly lastImportSummary: string | null;
  readonly lastImportKind: string | null;
  readonly lastImportTimestamp: Date | null;
  readonly lastError: string | null;
} {
  const commitment = useZkIdentity((s) => s.commitment);
  const lastError = useZkIdentity((s) => s.lastError);
  return {
    commitment,
    activeDid: null,
    jwkJson: null,
    didDocumentJson: null,
    serviceCount: 0,
    lastImportSummary: null,
    lastImportKind: null,
    lastImportTimestamp: null,
    lastError,
  };
}

/** Test-only — wipe the in-memory zustand cache between suites. */
export function __resetZkIdentityStoreForTesting(): void {
  useZkIdentity.setState({
    commitment: null,
    proofsSupported: false,
    isWorking: false,
    lastError: null,
    hydrated: false,
  });
}
