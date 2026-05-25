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

import { performBackupNow, DEFAULT_PROVIDER } from '@/backup';
import {
  useContactList,
  useContactStore,
  type ContactManifestEntry,
} from '@/contacts/repository';

export interface PeopleScreenState {
  readonly contacts: readonly ContactManifestEntry[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly refresh: () => void;
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

  useEffect(() => {
    seedFromManifest();
    void hydrate();
  }, [seedFromManifest, hydrate]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        await hydrate();
        await performBackupNow(DEFAULT_PROVIDER);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [hydrate]);

  return {
    contacts,
    loading: !detailsHydrated && contacts.length === 0,
    refreshing,
    refresh,
  };
}
