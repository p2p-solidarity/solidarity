/**
 * Hook backing the People tab. Subscribes to the in-memory contact store
 * (zustand, seeded from MMKV on construction) so the screen paints rows
 * on frame 1 without a skeleton flash. Background refresh re-hydrates
 * from cold storage and re-runs the backup pipeline.
 *
 * Lives in src/people/ not src/components/people/ so the screen file stays
 * a thin shell (per aniseekr-expo rule 9 — keep render state small).
 */
import { useCallback, useState } from 'react';

import { performBackupNow, DEFAULT_PROVIDER } from '@/backup';
import { useContactList, useContactStore } from '@/contacts/repository';
import type { Contact } from '@solidarity/shared';

export interface PeopleScreenState {
  readonly contacts: readonly Contact[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly refresh: () => void;
}

export function usePeopleScreen(): PeopleScreenState {
  // `useContactList` returns the live MMKV-seeded snapshot. No async
  // fetch on render path — that was the source of the skeleton flash
  // every time the tab focused.
  const contacts = useContactList();
  const hydrate = useContactStore((s) => s.hydrate);
  const hydrated = useContactStore((s) => s.hydrated);
  const [refreshing, setRefreshing] = useState(false);

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

  return { contacts, loading: !hydrated && contacts.length === 0, refreshing, refresh };
}
