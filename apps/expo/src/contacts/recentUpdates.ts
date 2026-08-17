import { create } from 'zustand';
import { z } from 'zod';

import type { getMmkv as GetMmkvFn } from '@/storage/mmkv';
import {
  canCommitLocalData,
  captureLocalDataEpoch,
} from '@/settings/localDataWipeBarrier';
import { stableJSON, uuid, type ProfileRecord } from '@solidarity/shared';

export const RECENT_UPDATES_STORAGE_KEY = 'contacts:recent-updates:v1';

export type RecentProfileChange = 'name' | 'bio' | 'avatar' | 'links';

export interface RecentProfileUpdate {
  readonly id: string;
  readonly did: string;
  readonly name: string;
  readonly changes: readonly RecentProfileChange[];
  readonly occurredAt: string;
}

interface PersistedRecentUpdates {
  readonly version: 1;
  readonly enabled: boolean;
  readonly expanded: boolean;
  readonly events: readonly RecentProfileUpdate[];
}

const recentProfileChangeSchema = z.enum(['name', 'bio', 'avatar', 'links']);
const recentProfileUpdateSchema = z.object({
  id: z.string().min(1),
  did: z.string().min(1),
  name: z.string(),
  changes: z.array(recentProfileChangeSchema).min(1),
  occurredAt: z.iso.datetime(),
}).strict();
const persistedRecentUpdatesSchema = z.object({
  version: z.literal(1),
  enabled: z.boolean(),
  expanded: z.boolean(),
  events: z.array(recentProfileUpdateSchema),
}).strict();

export interface RecentUpdatesStorage {
  readonly getString: (key: string) => string | null;
  readonly setString: (key: string, value: string) => void;
}

let cachedGetMmkv: typeof GetMmkvFn | undefined;
const defaultStorage: RecentUpdatesStorage = {
  getString: (key) => {
    if (!cachedGetMmkv) throw new Error('Recent updates storage is not ready.');
    return cachedGetMmkv().getString(key) ?? null;
  },
  setString: (key, value) => {
    if (!cachedGetMmkv) throw new Error('Recent updates storage is not ready.');
    cachedGetMmkv().set(key, value);
  },
};
let activeStorage = defaultStorage;

export function __setRecentUpdatesStorageForTesting(storage: RecentUpdatesStorage | null): void {
  activeStorage = storage ?? defaultStorage;
}

export async function prepareRecentUpdates(): Promise<void> {
  const hydrationEpoch = captureLocalDataEpoch();
  try {
    const mod = await import('@/storage/mmkv');
    cachedGetMmkv = mod.getMmkv;
  } finally {
    if (canCommitLocalData(hydrationEpoch)) hydrateRecentUpdates();
  }
}

export function createRecentProfileUpdate(
  existing: ProfileRecord | undefined,
  incoming: ProfileRecord,
  id: string,
  occurredAt: string,
): RecentProfileUpdate | null {
  if (!existing || Date.parse(incoming.updatedAt) <= Date.parse(existing.updatedAt)) return null;
  const changes: RecentProfileChange[] = [];
  if (existing.displayName !== incoming.displayName) changes.push('name');
  if (existing.bio !== incoming.bio) changes.push('bio');
  if (existing.avatar !== incoming.avatar) changes.push('avatar');
  if (stableJSON(existing.links) !== stableJSON(incoming.links)) changes.push('links');
  if (changes.length === 0) return null;
  return {
    id,
    did: incoming.did,
    name: incoming.displayName,
    changes,
    occurredAt,
  };
}

function initial(): PersistedRecentUpdates {
  return { version: 1, enabled: true, expanded: true, events: [] };
}

function readPersisted(raw: string): PersistedRecentUpdates | null {
  try {
    const parsed = persistedRecentUpdatesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function persist(value: PersistedRecentUpdates): boolean {
  if (!canCommitLocalData(captureLocalDataEpoch())) return false;
  try {
    activeStorage.setString(RECENT_UPDATES_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

interface RecentUpdatesState extends PersistedRecentUpdates {
  readonly status: 'loading' | 'ready' | 'error';
  readonly recordMerge: (
    existing: ProfileRecord | undefined,
    incoming: ProfileRecord,
    id?: string,
    occurredAt?: string,
  ) => void;
  readonly setExpanded: (expanded: boolean) => void;
  readonly setEnabled: (enabled: boolean) => void;
  readonly clear: () => void;
  /** Clear only live references; durable data is removed by the wipe owner. */
  readonly resetForLocalWipe: () => void;
}

const INITIAL_STATE = { ...initial(), status: 'loading' as const };

export const useRecentUpdatesStore = create<RecentUpdatesState>((set, get) => {
  const commit = (next: PersistedRecentUpdates): void => {
    if (!canCommitLocalData(captureLocalDataEpoch())) return;
    if (!persist(next)) {
      set({ status: 'error' });
      return;
    }
    set({ ...next, status: 'ready' });
  };
  return {
    ...INITIAL_STATE,
    recordMerge: (existing, incoming, id = uuid(), occurredAt = new Date().toISOString()) => {
      const event = createRecentProfileUpdate(existing, incoming, id, occurredAt);
      if (!event) return;
      const current = get();
      commit({
        version: 1,
        enabled: current.enabled,
        expanded: current.expanded,
        events: [event, ...current.events.filter((item) => item.did !== event.did)].slice(0, 30),
      });
    },
    setExpanded: (expanded) => {
      const current = get();
      commit({ version: 1, enabled: current.enabled, expanded, events: current.events });
    },
    setEnabled: (enabled) => {
      const current = get();
      commit({ version: 1, enabled, expanded: current.expanded, events: current.events });
    },
    clear: () => {
      const current = get();
      commit({ version: 1, enabled: current.enabled, expanded: current.expanded, events: [] });
    },
    resetForLocalWipe: () => {
      set(INITIAL_STATE);
    },
  };
});

export function hydrateRecentUpdates(): void {
  if (!canCommitLocalData(captureLocalDataEpoch())) return;
  try {
    const raw = activeStorage.getString(RECENT_UPDATES_STORAGE_KEY);
    if (raw === null) {
      const value = initial();
      if (!persist(value)) throw new Error('write failed');
      useRecentUpdatesStore.setState({ ...value, status: 'ready' });
      return;
    }
    const parsed = readPersisted(raw);
    if (!parsed) {
      useRecentUpdatesStore.setState({ status: 'error' });
      return;
    }
    useRecentUpdatesStore.setState({ ...parsed, status: 'ready' });
  } catch {
    useRecentUpdatesStore.setState({ status: 'error' });
  }
}

export function resetRecentUpdatesStoreForTesting(): void {
  useRecentUpdatesStore.setState(INITIAL_STATE);
}
