/**
 * Hook backing the People tab. Subscribes to the in-memory contact store
 * (zustand, seeded from MMKV manifest on construction) so the screen paints
 * rows on frame 1 without a skeleton flash. Background refresh re-hydrates
 * every encrypted contact record and re-runs the backup pipeline.
 *
 * Lives in src/people/ not src/components/people/ so the screen file stays
 * a thin shell (per aniseekr-expo rule 9 — keep render state small).
 *
 * Path A boot order:
 *   1. `seedFromManifest()` mirrors the MMKV manifest into the zustand
 *      `manifest` array — runs on first focus so the rows render before
 *      any decryption work.
 *   2. `hydrate()` bulk-decrypts every Contact in the background — drives
 *      the loading flag only on a cold cache (no rows AND no manifest).
 */
import { useCallback, useEffect, useState } from 'react';

import { requestBackup } from '@/backup';
import {
  useContactList,
  useContactStore,
  type ContactManifestEntry,
} from '@/contacts/repository';

export interface PeopleScreenState {
  readonly contacts: readonly ContactManifestEntry[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly refreshing: boolean;
  readonly refresh: () => void;
  readonly retry: () => void;
}

export function usePeopleScreen(): PeopleScreenState {
  // `useContactList` returns the manifest array, seeded synchronously from
  // MMKV via `seedFromManifest`. No async fetch on the render path — that
  // was the source of the skeleton flash every time the tab focused.
  const contacts = useContactList();
  const seedFromManifest = useContactStore((s) => s.seedFromManifest);
  const hydrate = useContactStore((s) => s.hydrate);
  const detailsHydrated = useContactStore((s) => s.detailsHydrated);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const hydrateContacts = useCallback(async (): Promise<boolean> => {
    setLoadError(false);
    try {
      await hydrate();
      return true;
    } catch {
      setLoadError(true);
      return false;
    }
  }, [hydrate]);

  useEffect(() => {
    seedFromManifest();
    void hydrateContacts();
  }, [seedFromManifest, hydrateContacts]);

  const retry = useCallback(() => {
    void hydrateContacts();
  }, [hydrateContacts]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        const hydrated = await hydrateContacts();
        if (!hydrated) return;
        // Self-gates on backupEnabled + autoBackupOnPull + the shared cooldown,
        // and uses the user's chosen provider — no more unconditional backup.
        await requestBackup('pull');
      } finally {
        setRefreshing(false);
      }
    })();
  }, [hydrateContacts]);

  return {
    contacts,
    loading: !loadError && !detailsHydrated && contacts.length === 0,
    error: loadError,
    refreshing,
    refresh,
    retry,
  };
}
