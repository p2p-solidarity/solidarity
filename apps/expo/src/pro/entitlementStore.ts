import { create } from 'zustand';

import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';
import type { getMmkv as GetMmkvFn } from '@/storage/mmkv';

import {
  evaluateProStatus,
  isProActive,
  parseProEntitlement,
  type ProEntitlementRecord,
  type ProStatus,
} from './entitlement';

export const PRO_ENTITLEMENT_STORAGE_KEY = 'pro:entitlement:v1';

export interface ProEntitlementStorage {
  readonly getString: (key: string) => string | null;
  readonly setString: (key: string, value: string) => void;
  readonly remove: (key: string) => void;
}

let cachedGetMmkv: typeof GetMmkvFn | undefined;

const defaultStorage: ProEntitlementStorage = {
  getString: (key) => {
    if (!cachedGetMmkv) throw new Error('Pro entitlement storage is not ready.');
    return cachedGetMmkv().getString(key) ?? null;
  },
  setString: (key, value) => {
    if (!cachedGetMmkv) throw new Error('Pro entitlement storage is not ready.');
    cachedGetMmkv().set(key, value);
  },
  remove: (key) => {
    if (!cachedGetMmkv) throw new Error('Pro entitlement storage is not ready.');
    cachedGetMmkv().remove(key);
  },
};

let activeStorage = defaultStorage;

export function __setProEntitlementStorageForTesting(
  storage: ProEntitlementStorage | null
): void {
  activeStorage = storage ?? defaultStorage;
}

/** Resolve the already-open MMKV handle without pulling native storage into
 *  pure store tests at module load time. */
export async function warmProEntitlementStorage(): Promise<void> {
  const mod = await import('@/storage/mmkv');
  cachedGetMmkv = mod.getMmkv;
}

export async function prepareProEntitlement(): Promise<void> {
  if (activeStorage === defaultStorage) {
    try {
      await warmProEntitlementStorage();
    } catch {
      // `hydrateProEntitlement` turns an unavailable handle into the store's
      // explicit error state rather than leaving it stuck loading.
    }
  }
  hydrateProEntitlement();
}

export type ProEntitlementStatus = 'loading' | 'ready' | 'error';

interface ProEntitlementState {
  readonly status: ProEntitlementStatus;
  readonly record: ProEntitlementRecord | null;
  /** When we last completed a refresh attempt, successful or not. Drives the
   *  "couldn't reach the store" copy; never itself grants entitlement. */
  readonly lastCheckedAt: number | null;
  /** Record a verified entitlement from a store or the license bridge. */
  readonly applyEntitlement: (record: ProEntitlementRecord) => void;
  /** Drop entitlement because an authority told us it is gone (refund,
   *  cancellation, a license the bridge refused to renew) — never because a
   *  refresh merely failed. */
  readonly clearEntitlement: () => void;
  /** A refresh ran and could not reach an authority. Keeps the cached record
   *  and lets the offline grace window do its job. */
  readonly markCheckFailed: (at: number) => void;
  readonly resetForLocalWipe: () => void;
}

const INITIAL_STATE = {
  status: 'loading' as const,
  record: null,
  lastCheckedAt: null,
};

export const useProEntitlementStore = create<ProEntitlementState>((set) => ({
  ...INITIAL_STATE,

  applyEntitlement: (record) => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    try {
      activeStorage.setString(PRO_ENTITLEMENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // A persistence failure must not deny access the user has already paid
      // for — hold it in memory for this session and re-verify on next launch.
      set({ status: 'ready', record, lastCheckedAt: record.verifiedAt });
      return;
    }
    set({ status: 'ready', record, lastCheckedAt: record.verifiedAt });
  },

  clearEntitlement: () => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    try {
      activeStorage.remove(PRO_ENTITLEMENT_STORAGE_KEY);
    } catch {
      // Fall through: state below is the one the UI reads.
    }
    set({ status: 'ready', record: null });
  },

  markCheckFailed: (at) => {
    set({ lastCheckedAt: at });
  },

  resetForLocalWipe: () => {
    try {
      activeStorage.remove(PRO_ENTITLEMENT_STORAGE_KEY);
    } catch {
      // Best effort — the wipe coordinator clears the whole store anyway.
    }
    set({ ...INITIAL_STATE, status: 'ready' });
  },
}));

export function hydrateProEntitlement(): void {
  let raw: string | null;
  try {
    raw = activeStorage.getString(PRO_ENTITLEMENT_STORAGE_KEY);
  } catch {
    useProEntitlementStore.setState({ status: 'error', record: null });
    return;
  }

  if (!raw) {
    useProEntitlementStore.setState({ status: 'ready', record: null });
    return;
  }

  let parsed: ProEntitlementRecord | null;
  try {
    parsed = parseProEntitlement(JSON.parse(raw));
  } catch {
    parsed = null;
  }
  useProEntitlementStore.setState({ status: 'ready', record: parsed });
}

export function __resetProEntitlementStoreForTesting(): void {
  useProEntitlementStore.setState({ ...INITIAL_STATE });
}

/**
 * Current entitlement status.
 *
 * Evaluated against `Date.now()` at call time, so a session that is open
 * across an expiry boundary keeps the old answer until something re-renders.
 * That is deliberate: the refresh on app foreground is what moves the record,
 * and a ticking clock that could paywall someone mid-edit would be worse than
 * a few minutes of staleness.
 */
export function selectProStatus(state: ProEntitlementState): ProStatus {
  return evaluateProStatus(state.record, Date.now());
}

export function useProStatus(): ProStatus {
  return useProEntitlementStore(selectProStatus);
}

/** The predicate every feature gate should use. */
export function useIsPro(): boolean {
  return useProEntitlementStore((state) => isProActive(selectProStatus(state)));
}
