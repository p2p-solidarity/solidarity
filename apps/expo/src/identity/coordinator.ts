/**
 * IdentityCoordinator — slim TS port of
 * solidarity/Services/Identity/IdentityCoordinator.swift, scoped to the
 * profile/DID surface the React layer needs. ZK pieces stay in
 * `apps/expo/src/zk/coordinator.ts`; this store only exposes the active
 * `did:key` derived from the SpruceID-managed signing key.
 *
 * Hydration order mirrors Swift `loadIdentity`:
 *   1. `seedFromKeychain()` is fire-and-forget on first hook subscribe —
 *      it does ONE call to `didKeyForCurrentIdentity()` which reads the
 *      public JWK (no biometric prompt) and runs the multibase encoding.
 *   2. UI selectors read the cached `profile.activeDID.did` synchronously
 *      so the DID list paints frame 1 with the cached value.
 *
 * Failures: any keychain error is recorded in `lastError`; the UI shows
 * a placeholder, matching Swift behaviour when biometric is cancelled.
 */
import { create } from 'zustand';

import { didKeyForCurrentIdentity, ensureSigningKey } from '@/keychain/signingKey';

export interface DIDDescriptor {
  readonly did: string;
}

export interface UnifiedProfile {
  readonly activeDID: DIDDescriptor | null;
}

interface IdentityCoordinatorState {
  readonly profile: UnifiedProfile;
  readonly isLoading: boolean;
  readonly lastError: string | null;
  readonly hydrated: boolean;
  readonly seedFromKeychain: () => Promise<void>;
  readonly refreshIdentity: () => Promise<void>;
  readonly clearError: () => void;
}

async function deriveActiveDid(): Promise<string> {
  await ensureSigningKey();
  return await didKeyForCurrentIdentity();
}

export const useIdentityCoordinator = create<IdentityCoordinatorState>((set, get) => ({
  profile: { activeDID: null },
  isLoading: false,
  lastError: null,
  hydrated: false,

  seedFromKeychain: async () => {
    if (get().hydrated || get().isLoading) return;
    set({ isLoading: true, lastError: null });
    try {
      const did = await deriveActiveDid();
      set({
        profile: { activeDID: { did } },
        isLoading: false,
        hydrated: true,
      });
    } catch (error) {
      set({
        isLoading: false,
        hydrated: true,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  refreshIdentity: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, lastError: null });
    try {
      const did = await deriveActiveDid();
      set({
        profile: { activeDID: { did } },
        isLoading: false,
        hydrated: true,
      });
    } catch (error) {
      set({
        isLoading: false,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  },

  clearError: () => { set({ lastError: null }); },
}));

/** Selector — cached active DID string, null until keychain resolves. */
export function useActiveDid(): string | null {
  return useIdentityCoordinator((s) => s.profile.activeDID?.did ?? null);
}

/** Test-only — wipe the in-memory cache between suites. */
export function __resetIdentityCoordinatorForTesting(): void {
  useIdentityCoordinator.setState({
    profile: { activeDID: null },
    isLoading: false,
    lastError: null,
    hydrated: false,
  });
}
