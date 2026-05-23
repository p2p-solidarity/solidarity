/**
 * Hook backing the People tab. Loads contacts from MMKV-backed storage,
 * memoises filter state, and exposes a `refresh` action wired to the
 * gesture-triggered backup pipeline.
 *
 * Lives in src/people/ not src/components/people/ so the screen file stays
 * a thin shell (per aniseekr-expo rule 9 — keep render state small).
 */
import { useCallback, useEffect, useState } from 'react';

import { loadAllContacts } from '@/storage';
import { performBackupNow, DEFAULT_PROVIDER } from '@/backup';
import type { Contact } from '@solidarity/shared';

export interface PeopleScreenState {
  readonly contacts: readonly Contact[];
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly refresh: () => void;
}

export function usePeopleScreen(): PeopleScreenState {
  const [contacts, setContacts] = useState<readonly Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await loadAllContacts();
    setContacts(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        await load();
        await performBackupNow(DEFAULT_PROVIDER);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [load]);

  return { contacts, loading, refreshing, refresh };
}
